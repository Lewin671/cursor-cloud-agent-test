package service

import (
	"context"
	"database/sql"
	"time"

	"github.com/google/uuid"

	apperrors "pomodoro/backend/internal/errors"
	"pomodoro/backend/internal/model"
	"pomodoro/backend/internal/repository"
)

type PomodoroService struct {
	repo *repository.PomodoroRepository
}

type StateView struct {
	UserID                    string     `json:"userId"`
	Mode                      string     `json:"mode"`
	Status                    string     `json:"status"`
	RemainingSeconds          int        `json:"remainingSeconds"`
	FocusDurationSeconds      int        `json:"focusDurationSeconds"`
	ShortBreakDurationSeconds int        `json:"shortBreakDurationSeconds"`
	LongBreakDurationSeconds  int        `json:"longBreakDurationSeconds"`
	StartedAt                 *time.Time `json:"startedAt,omitempty"`
	SessionID                 *string    `json:"sessionId,omitempty"`
	Version                   int        `json:"version"`
	UpdatedAt                 time.Time  `json:"updatedAt"`
	ServerTime                time.Time  `json:"serverTime"`
}

type UpdateSettingsInput struct {
	BaseVersion               int
	FocusDurationSeconds      int
	ShortBreakDurationSeconds int
	LongBreakDurationSeconds  int
}

func NewPomodoroService(repo *repository.PomodoroRepository) *PomodoroService {
	return &PomodoroService{repo: repo}
}

func (s *PomodoroService) GetState(ctx context.Context, userID string) (*StateView, *apperrors.APIError) {
	now := time.Now().UTC()
	tx, err := s.repo.BeginTx(ctx)
	if err != nil {
		return nil, apperrors.Internal("failed to start transaction")
	}
	defer tx.Rollback()

	state, err := s.repo.GetStateTx(ctx, tx, userID)
	if err == repository.ErrNotFound {
		return nil, apperrors.NotFound("state_not_found", "pomodoro state not found")
	}
	if err != nil {
		return nil, apperrors.Internal("failed to get state")
	}

	if err := s.normalizeCompletedSession(ctx, tx, state, now); err != nil {
		return nil, err
	}

	if commitErr := tx.Commit(); commitErr != nil {
		return nil, apperrors.Internal("failed to commit transaction")
	}

	view := s.toStateView(state, now)
	return &view, nil
}

func (s *PomodoroService) Start(ctx context.Context, userID string, baseVersion int) (*StateView, *apperrors.APIError) {
	now := time.Now().UTC()
	tx, err := s.repo.BeginTx(ctx)
	if err != nil {
		return nil, apperrors.Internal("failed to start transaction")
	}
	defer tx.Rollback()

	state, apiErr := s.getStateForUpdate(ctx, tx, userID, now)
	if apiErr != nil {
		return nil, apiErr
	}

	if apiErr := s.ensureVersion(baseVersion, state, now); apiErr != nil {
		return nil, apiErr
	}

	if state.Status == model.StatusRunning {
		view := s.toStateView(state, now)
		return &view, nil
	}

	if state.Status == model.StatusIdle {
		state.RemainingSeconds = s.durationForMode(state)
	}

	if state.SessionID == nil {
		sessionID := uuid.NewString()
		state.SessionID = &sessionID

		session := model.PomodoroSession{
			ID:                     sessionID,
			UserID:                 userID,
			Mode:                   state.Mode,
			PlannedDurationSeconds: state.RemainingSeconds,
			ActualDurationSeconds:  0,
			StartedAt:              now,
			Status:                 "running",
			CreatedAt:              now,
			UpdatedAt:              now,
		}
		if err := s.repo.InsertSessionTx(ctx, tx, &session); err != nil {
			return nil, apperrors.Internal("failed to create focus session")
		}
	}

	state.Status = model.StatusRunning
	state.StartedAt = &now
	state.UpdatedAt = now
	state.Version++

	if err := s.repo.UpdateStateTx(ctx, tx, state); err != nil {
		return nil, apperrors.Internal("failed to update state")
	}

	if commitErr := tx.Commit(); commitErr != nil {
		return nil, apperrors.Internal("failed to commit transaction")
	}

	view := s.toStateView(state, now)
	return &view, nil
}

func (s *PomodoroService) Pause(ctx context.Context, userID string, baseVersion int) (*StateView, *apperrors.APIError) {
	now := time.Now().UTC()
	tx, err := s.repo.BeginTx(ctx)
	if err != nil {
		return nil, apperrors.Internal("failed to start transaction")
	}
	defer tx.Rollback()

	state, apiErr := s.getStateForUpdate(ctx, tx, userID, now)
	if apiErr != nil {
		return nil, apiErr
	}

	if apiErr := s.ensureVersion(baseVersion, state, now); apiErr != nil {
		return nil, apiErr
	}

	if state.Status != model.StatusRunning {
		view := s.toStateView(state, now)
		return &view, nil
	}

	state.RemainingSeconds = s.currentRemainingSeconds(state, now)
	state.Status = model.StatusPaused
	state.StartedAt = nil
	state.UpdatedAt = now
	state.Version++

	if err := s.repo.UpdateStateTx(ctx, tx, state); err != nil {
		return nil, apperrors.Internal("failed to update state")
	}

	if commitErr := tx.Commit(); commitErr != nil {
		return nil, apperrors.Internal("failed to commit transaction")
	}

	view := s.toStateView(state, now)
	return &view, nil
}

func (s *PomodoroService) Reset(ctx context.Context, userID string, baseVersion int) (*StateView, *apperrors.APIError) {
	now := time.Now().UTC()
	tx, err := s.repo.BeginTx(ctx)
	if err != nil {
		return nil, apperrors.Internal("failed to start transaction")
	}
	defer tx.Rollback()

	state, apiErr := s.getStateForUpdate(ctx, tx, userID, now)
	if apiErr != nil {
		return nil, apiErr
	}

	if apiErr := s.ensureVersion(baseVersion, state, now); apiErr != nil {
		return nil, apiErr
	}

	if state.SessionID != nil {
		remaining := s.currentRemainingSeconds(state, now)
		if cancelErr := s.finishSession(ctx, tx, *state.SessionID, remaining, false, now); cancelErr != nil {
			return nil, cancelErr
		}
	}

	state.Status = model.StatusIdle
	state.StartedAt = nil
	state.SessionID = nil
	state.RemainingSeconds = s.durationForMode(state)
	state.UpdatedAt = now
	state.Version++

	if err := s.repo.UpdateStateTx(ctx, tx, state); err != nil {
		return nil, apperrors.Internal("failed to update state")
	}

	if commitErr := tx.Commit(); commitErr != nil {
		return nil, apperrors.Internal("failed to commit transaction")
	}

	view := s.toStateView(state, now)
	return &view, nil
}

func (s *PomodoroService) SwitchMode(ctx context.Context, userID, mode string, baseVersion int) (*StateView, *apperrors.APIError) {
	if !isValidMode(mode) {
		return nil, apperrors.BadRequest("invalid_mode", "mode must be one of focus, short_break, long_break")
	}

	now := time.Now().UTC()
	tx, err := s.repo.BeginTx(ctx)
	if err != nil {
		return nil, apperrors.Internal("failed to start transaction")
	}
	defer tx.Rollback()

	state, apiErr := s.getStateForUpdate(ctx, tx, userID, now)
	if apiErr != nil {
		return nil, apiErr
	}

	if apiErr := s.ensureVersion(baseVersion, state, now); apiErr != nil {
		return nil, apiErr
	}

	if state.SessionID != nil {
		remaining := s.currentRemainingSeconds(state, now)
		if cancelErr := s.finishSession(ctx, tx, *state.SessionID, remaining, false, now); cancelErr != nil {
			return nil, cancelErr
		}
	}

	state.Mode = mode
	state.Status = model.StatusIdle
	state.StartedAt = nil
	state.SessionID = nil
	state.RemainingSeconds = s.durationForMode(state)
	state.UpdatedAt = now
	state.Version++

	if err := s.repo.UpdateStateTx(ctx, tx, state); err != nil {
		return nil, apperrors.Internal("failed to update state")
	}

	if commitErr := tx.Commit(); commitErr != nil {
		return nil, apperrors.Internal("failed to commit transaction")
	}

	view := s.toStateView(state, now)
	return &view, nil
}

func (s *PomodoroService) UpdateSettings(ctx context.Context, userID string, input UpdateSettingsInput) (*StateView, *apperrors.APIError) {
	if input.FocusDurationSeconds <= 0 || input.ShortBreakDurationSeconds <= 0 || input.LongBreakDurationSeconds <= 0 {
		return nil, apperrors.BadRequest("invalid_duration", "all durations must be positive seconds")
	}

	now := time.Now().UTC()
	tx, err := s.repo.BeginTx(ctx)
	if err != nil {
		return nil, apperrors.Internal("failed to start transaction")
	}
	defer tx.Rollback()

	state, apiErr := s.getStateForUpdate(ctx, tx, userID, now)
	if apiErr != nil {
		return nil, apiErr
	}

	if apiErr := s.ensureVersion(input.BaseVersion, state, now); apiErr != nil {
		return nil, apiErr
	}

	state.FocusDurationSeconds = input.FocusDurationSeconds
	state.ShortBreakDurationSeconds = input.ShortBreakDurationSeconds
	state.LongBreakDurationSeconds = input.LongBreakDurationSeconds

	if state.Status != model.StatusRunning {
		state.RemainingSeconds = s.durationForMode(state)
	}

	state.UpdatedAt = now
	state.Version++

	if err := s.repo.UpdateStateTx(ctx, tx, state); err != nil {
		return nil, apperrors.Internal("failed to update state")
	}

	if commitErr := tx.Commit(); commitErr != nil {
		return nil, apperrors.Internal("failed to commit transaction")
	}

	view := s.toStateView(state, now)
	return &view, nil
}

func (s *PomodoroService) GetHistory(ctx context.Context, userID string, limit int) ([]model.PomodoroSession, *apperrors.APIError) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	sessions, err := s.repo.ListSessions(ctx, userID, limit)
	if err != nil {
		return nil, apperrors.Internal("failed to get history")
	}
	return sessions, nil
}

func (s *PomodoroService) getStateForUpdate(ctx context.Context, tx *sql.Tx, userID string, now time.Time) (*model.PomodoroState, *apperrors.APIError) {
	state, err := s.repo.GetStateTx(ctx, tx, userID)
	if err == repository.ErrNotFound {
		return nil, apperrors.NotFound("state_not_found", "pomodoro state not found")
	}
	if err != nil {
		return nil, apperrors.Internal("failed to get state")
	}

	if normalizeErr := s.normalizeCompletedSession(ctx, tx, state, now); normalizeErr != nil {
		return nil, normalizeErr
	}
	return state, nil
}

func (s *PomodoroService) normalizeCompletedSession(ctx context.Context, tx *sql.Tx, state *model.PomodoroState, now time.Time) *apperrors.APIError {
	if state.Status != model.StatusRunning || state.StartedAt == nil {
		return nil
	}

	if s.currentRemainingSeconds(state, now) > 0 {
		return nil
	}

	if state.SessionID != nil {
		if err := s.finishSession(ctx, tx, *state.SessionID, 0, true, now); err != nil {
			return err
		}
	}

	state.Status = model.StatusIdle
	state.StartedAt = nil
	state.SessionID = nil
	state.RemainingSeconds = s.durationForMode(state)
	state.UpdatedAt = now
	state.Version++

	if err := s.repo.UpdateStateTx(ctx, tx, state); err != nil {
		return apperrors.Internal("failed to persist completed state")
	}
	return nil
}

func (s *PomodoroService) ensureVersion(baseVersion int, state *model.PomodoroState, now time.Time) *apperrors.APIError {
	if baseVersion <= 0 || baseVersion == state.Version {
		return nil
	}
	view := s.toStateView(state, now)
	return apperrors.Conflict("state_conflict", "state changed on another device", map[string]interface{}{
		"state": view,
	})
}

func (s *PomodoroService) currentRemainingSeconds(state *model.PomodoroState, now time.Time) int {
	if state.Status != model.StatusRunning || state.StartedAt == nil {
		if state.RemainingSeconds < 0 {
			return 0
		}
		return state.RemainingSeconds
	}

	elapsed := int(now.Sub(*state.StartedAt).Seconds())
	remaining := state.RemainingSeconds - elapsed
	if remaining < 0 {
		return 0
	}
	return remaining
}

func (s *PomodoroService) durationForMode(state *model.PomodoroState) int {
	switch state.Mode {
	case model.ModeShortBreak:
		return state.ShortBreakDurationSeconds
	case model.ModeLongBreak:
		return state.LongBreakDurationSeconds
	default:
		return state.FocusDurationSeconds
	}
}

func (s *PomodoroService) finishSession(
	ctx context.Context,
	tx *sql.Tx,
	sessionID string,
	remainingSeconds int,
	completed bool,
	now time.Time,
) *apperrors.APIError {
	session, err := s.repo.GetSessionTx(ctx, tx, sessionID)
	if err == repository.ErrNotFound {
		return nil
	}
	if err != nil {
		return apperrors.Internal("failed to read session")
	}
	if session.Status != "running" {
		return nil
	}

	if remainingSeconds < 0 {
		remainingSeconds = 0
	}
	actual := session.PlannedDurationSeconds - remainingSeconds
	if actual < 0 {
		actual = 0
	}
	if actual > session.PlannedDurationSeconds {
		actual = session.PlannedDurationSeconds
	}

	if completed {
		session.Status = "completed"
	} else {
		session.Status = "cancelled"
	}
	session.ActualDurationSeconds = actual
	session.EndedAt = &now
	session.UpdatedAt = now

	if err := s.repo.UpdateSessionTx(ctx, tx, session); err != nil {
		return apperrors.Internal("failed to update session")
	}
	return nil
}

func (s *PomodoroService) toStateView(state *model.PomodoroState, now time.Time) StateView {
	view := StateView{
		UserID:                    state.UserID,
		Mode:                      state.Mode,
		Status:                    state.Status,
		RemainingSeconds:          state.RemainingSeconds,
		FocusDurationSeconds:      state.FocusDurationSeconds,
		ShortBreakDurationSeconds: state.ShortBreakDurationSeconds,
		LongBreakDurationSeconds:  state.LongBreakDurationSeconds,
		SessionID:                 state.SessionID,
		Version:                   state.Version,
		UpdatedAt:                 state.UpdatedAt,
		ServerTime:                now,
	}

	if state.Status == model.StatusRunning {
		remaining := s.currentRemainingSeconds(state, now)
		view.RemainingSeconds = remaining
		snapshot := now
		view.StartedAt = &snapshot
	}

	return view
}

func isValidMode(mode string) bool {
	return mode == model.ModeFocus || mode == model.ModeShortBreak || mode == model.ModeLongBreak
}
