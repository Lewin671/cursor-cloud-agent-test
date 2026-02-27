import type { PomodoroMode, PomodoroSession, PomodoroState } from "../types";
import { request } from "./client";

type StateResponse = {
  state: PomodoroState;
};

type HistoryResponse = {
  sessions: PomodoroSession[];
};

export function fetchState(token: string): Promise<StateResponse> {
  return request<StateResponse>("/pomodoro/state", { token });
}

export function startTimer(token: string, baseVersion: number): Promise<StateResponse> {
  return request<StateResponse>("/pomodoro/start", {
    method: "POST",
    token,
    body: { baseVersion },
  });
}

export function pauseTimer(token: string, baseVersion: number): Promise<StateResponse> {
  return request<StateResponse>("/pomodoro/pause", {
    method: "POST",
    token,
    body: { baseVersion },
  });
}

export function resetTimer(token: string, baseVersion: number): Promise<StateResponse> {
  return request<StateResponse>("/pomodoro/reset", {
    method: "POST",
    token,
    body: { baseVersion },
  });
}

export function switchMode(
  token: string,
  mode: PomodoroMode,
  baseVersion: number,
): Promise<StateResponse> {
  return request<StateResponse>("/pomodoro/mode", {
    method: "POST",
    token,
    body: { mode, baseVersion },
  });
}

export function updateSettings(
  token: string,
  input: {
    baseVersion: number;
    focusDurationSeconds: number;
    shortBreakDurationSeconds: number;
    longBreakDurationSeconds: number;
  },
): Promise<StateResponse> {
  return request<StateResponse>("/pomodoro/settings", {
    method: "PUT",
    token,
    body: input,
  });
}

export function fetchHistory(token: string, limit = 50): Promise<HistoryResponse> {
  return request<HistoryResponse>(`/pomodoro/history?limit=${limit}`, { token });
}
