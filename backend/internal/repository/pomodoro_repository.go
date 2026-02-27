package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"pomodoro/backend/internal/model"
)

type PomodoroRepository struct {
	db *sql.DB
}

func NewPomodoroRepository(db *sql.DB) *PomodoroRepository {
	return &PomodoroRepository{db: db}
}

func (r *PomodoroRepository) BeginTx(ctx context.Context) (*sql.Tx, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	return tx, nil
}

func (r *PomodoroRepository) CreateInitialState(ctx context.Context, userID string) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err := r.db.ExecContext(
		ctx,
		`INSERT INTO pomodoro_states (
			user_id, mode, status, remaining_seconds, focus_duration_seconds,
			short_break_duration_seconds, long_break_duration_seconds, version, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		userID,
		model.ModeFocus,
		model.StatusIdle,
		model.DefaultFocusDurationSeconds,
		model.DefaultFocusDurationSeconds,
		model.DefaultShortBreakDurationSeconds,
		model.DefaultLongBreakDurationSeconds,
		1,
		now,
	)
	if err != nil {
		return fmt.Errorf("create initial state: %w", err)
	}
	return nil
}

func (r *PomodoroRepository) GetState(ctx context.Context, userID string) (*model.PomodoroState, error) {
	row := r.db.QueryRowContext(
		ctx,
		`SELECT user_id, mode, status, remaining_seconds, focus_duration_seconds,
		        short_break_duration_seconds, long_break_duration_seconds,
				started_at, session_id, version, updated_at
		 FROM pomodoro_states WHERE user_id = ?`,
		userID,
	)
	state, err := scanPomodoroState(row)
	if err != nil {
		return nil, err
	}
	return state, nil
}

func (r *PomodoroRepository) GetStateTx(ctx context.Context, tx *sql.Tx, userID string) (*model.PomodoroState, error) {
	row := tx.QueryRowContext(
		ctx,
		`SELECT user_id, mode, status, remaining_seconds, focus_duration_seconds,
		        short_break_duration_seconds, long_break_duration_seconds,
				started_at, session_id, version, updated_at
		 FROM pomodoro_states WHERE user_id = ?`,
		userID,
	)
	state, err := scanPomodoroState(row)
	if err != nil {
		return nil, err
	}
	return state, nil
}

func (r *PomodoroRepository) UpdateStateTx(ctx context.Context, tx *sql.Tx, state *model.PomodoroState) error {
	var startedAt interface{}
	if state.StartedAt != nil {
		startedAt = state.StartedAt.UTC().Format(time.RFC3339Nano)
	}
	var sessionID interface{}
	if state.SessionID != nil {
		sessionID = *state.SessionID
	}

	_, err := tx.ExecContext(
		ctx,
		`UPDATE pomodoro_states
		 SET mode = ?,
		     status = ?,
			 remaining_seconds = ?,
			 focus_duration_seconds = ?,
			 short_break_duration_seconds = ?,
			 long_break_duration_seconds = ?,
			 started_at = ?,
			 session_id = ?,
			 version = ?,
			 updated_at = ?
		 WHERE user_id = ?`,
		state.Mode,
		state.Status,
		state.RemainingSeconds,
		state.FocusDurationSeconds,
		state.ShortBreakDurationSeconds,
		state.LongBreakDurationSeconds,
		startedAt,
		sessionID,
		state.Version,
		state.UpdatedAt.UTC().Format(time.RFC3339Nano),
		state.UserID,
	)
	if err != nil {
		return fmt.Errorf("update state: %w", err)
	}
	return nil
}

func (r *PomodoroRepository) InsertSessionTx(ctx context.Context, tx *sql.Tx, session *model.PomodoroSession) error {
	var endedAt interface{}
	if session.EndedAt != nil {
		endedAt = session.EndedAt.UTC().Format(time.RFC3339Nano)
	}

	_, err := tx.ExecContext(
		ctx,
		`INSERT INTO pomodoro_sessions (
			id, user_id, mode, planned_duration_seconds, actual_duration_seconds,
			started_at, ended_at, status, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		session.ID,
		session.UserID,
		session.Mode,
		session.PlannedDurationSeconds,
		session.ActualDurationSeconds,
		session.StartedAt.UTC().Format(time.RFC3339Nano),
		endedAt,
		session.Status,
		session.CreatedAt.UTC().Format(time.RFC3339Nano),
		session.UpdatedAt.UTC().Format(time.RFC3339Nano),
	)
	if err != nil {
		return fmt.Errorf("insert session: %w", err)
	}
	return nil
}

func (r *PomodoroRepository) GetSessionTx(ctx context.Context, tx *sql.Tx, sessionID string) (*model.PomodoroSession, error) {
	row := tx.QueryRowContext(
		ctx,
		`SELECT id, user_id, mode, planned_duration_seconds, actual_duration_seconds,
		        started_at, ended_at, status, created_at, updated_at
		 FROM pomodoro_sessions
		 WHERE id = ?`,
		sessionID,
	)
	session, err := scanPomodoroSession(row)
	if err != nil {
		return nil, err
	}
	return session, nil
}

func (r *PomodoroRepository) UpdateSessionTx(ctx context.Context, tx *sql.Tx, session *model.PomodoroSession) error {
	var endedAt interface{}
	if session.EndedAt != nil {
		endedAt = session.EndedAt.UTC().Format(time.RFC3339Nano)
	}

	_, err := tx.ExecContext(
		ctx,
		`UPDATE pomodoro_sessions
		 SET mode = ?,
		     planned_duration_seconds = ?,
			 actual_duration_seconds = ?,
			 started_at = ?,
			 ended_at = ?,
			 status = ?,
			 updated_at = ?
		 WHERE id = ?`,
		session.Mode,
		session.PlannedDurationSeconds,
		session.ActualDurationSeconds,
		session.StartedAt.UTC().Format(time.RFC3339Nano),
		endedAt,
		session.Status,
		session.UpdatedAt.UTC().Format(time.RFC3339Nano),
		session.ID,
	)
	if err != nil {
		return fmt.Errorf("update session: %w", err)
	}
	return nil
}

func (r *PomodoroRepository) ListSessions(ctx context.Context, userID string, limit int) ([]model.PomodoroSession, error) {
	rows, err := r.db.QueryContext(
		ctx,
		`SELECT id, user_id, mode, planned_duration_seconds, actual_duration_seconds,
		        started_at, ended_at, status, created_at, updated_at
		 FROM pomodoro_sessions
		 WHERE user_id = ?
		 ORDER BY started_at DESC
		 LIMIT ?`,
		userID,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer rows.Close()

	sessions := make([]model.PomodoroSession, 0, limit)
	for rows.Next() {
		session, scanErr := scanPomodoroSession(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		sessions = append(sessions, *session)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sessions: %w", err)
	}

	return sessions, nil
}

type scanner interface {
	Scan(dest ...interface{}) error
}

func scanPomodoroState(s scanner) (*model.PomodoroState, error) {
	state := model.PomodoroState{}
	var startedAt sql.NullString
	var sessionID sql.NullString
	var updatedAt string
	err := s.Scan(
		&state.UserID,
		&state.Mode,
		&state.Status,
		&state.RemainingSeconds,
		&state.FocusDurationSeconds,
		&state.ShortBreakDurationSeconds,
		&state.LongBreakDurationSeconds,
		&startedAt,
		&sessionID,
		&state.Version,
		&updatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan state: %w", err)
	}

	if startedAt.Valid {
		parsedStartedAt, parseErr := parseTime(startedAt.String)
		if parseErr != nil {
			return nil, fmt.Errorf("parse state started_at: %w", parseErr)
		}
		state.StartedAt = &parsedStartedAt
	}
	if sessionID.Valid {
		value := sessionID.String
		state.SessionID = &value
	}

	parsedUpdatedAt, parseErr := parseTime(updatedAt)
	if parseErr != nil {
		return nil, fmt.Errorf("parse state updated_at: %w", parseErr)
	}
	state.UpdatedAt = parsedUpdatedAt
	return &state, nil
}

func scanPomodoroSession(s scanner) (*model.PomodoroSession, error) {
	session := model.PomodoroSession{}
	var startedAt string
	var endedAt sql.NullString
	var createdAt string
	var updatedAt string
	err := s.Scan(
		&session.ID,
		&session.UserID,
		&session.Mode,
		&session.PlannedDurationSeconds,
		&session.ActualDurationSeconds,
		&startedAt,
		&endedAt,
		&session.Status,
		&createdAt,
		&updatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan session: %w", err)
	}

	parsedStartedAt, err := parseTime(startedAt)
	if err != nil {
		return nil, fmt.Errorf("parse session started_at: %w", err)
	}
	session.StartedAt = parsedStartedAt

	if endedAt.Valid {
		parsedEndedAt, parseErr := parseTime(endedAt.String)
		if parseErr != nil {
			return nil, fmt.Errorf("parse session ended_at: %w", parseErr)
		}
		session.EndedAt = &parsedEndedAt
	}

	parsedCreatedAt, err := parseTime(createdAt)
	if err != nil {
		return nil, fmt.Errorf("parse session created_at: %w", err)
	}
	session.CreatedAt = parsedCreatedAt

	parsedUpdatedAt, err := parseTime(updatedAt)
	if err != nil {
		return nil, fmt.Errorf("parse session updated_at: %w", err)
	}
	session.UpdatedAt = parsedUpdatedAt

	return &session, nil
}
