export type User = {
  id: string;
  email: string;
};

export type AuthResponse = {
  token: string;
  user: User;
};

export type PomodoroMode = "focus" | "short_break" | "long_break";
export type PomodoroStatus = "idle" | "running" | "paused";

export type PomodoroState = {
  userId: string;
  mode: PomodoroMode;
  status: PomodoroStatus;
  remainingSeconds: number;
  focusDurationSeconds: number;
  shortBreakDurationSeconds: number;
  longBreakDurationSeconds: number;
  startedAt?: string;
  sessionId?: string;
  version: number;
  updatedAt: string;
  serverTime: string;
};

export type SessionStatus = "running" | "completed" | "cancelled";

export type PomodoroSession = {
  id: string;
  userId: string;
  mode: PomodoroMode;
  plannedDurationSeconds: number;
  actualDurationSeconds: number;
  startedAt: string;
  endedAt?: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
};
