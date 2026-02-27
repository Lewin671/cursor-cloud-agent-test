package model

import "time"

const (
	ModeFocus      = "focus"
	ModeShortBreak = "short_break"
	ModeLongBreak  = "long_break"

	StatusIdle    = "idle"
	StatusRunning = "running"
	StatusPaused  = "paused"
)

const (
	DefaultFocusDurationSeconds      = 25 * 60
	DefaultShortBreakDurationSeconds = 5 * 60
	DefaultLongBreakDurationSeconds  = 15 * 60
)

type PomodoroState struct {
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
}

type PomodoroSession struct {
	ID                     string     `json:"id"`
	UserID                 string     `json:"userId"`
	Mode                   string     `json:"mode"`
	PlannedDurationSeconds int        `json:"plannedDurationSeconds"`
	ActualDurationSeconds  int        `json:"actualDurationSeconds"`
	StartedAt              time.Time  `json:"startedAt"`
	EndedAt                *time.Time `json:"endedAt,omitempty"`
	Status                 string     `json:"status"`
	CreatedAt              time.Time  `json:"createdAt"`
	UpdatedAt              time.Time  `json:"updatedAt"`
}
