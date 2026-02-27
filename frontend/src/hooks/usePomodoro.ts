import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "../api/client";
import * as pomodoroApi from "../api/pomodoro";
import type { PomodoroMode, PomodoroSession, PomodoroState } from "../types";

type UsePomodoroResult = {
  state: PomodoroState | null;
  history: PomodoroSession[];
  loading: boolean;
  actionLoading: boolean;
  error: string | null;
  syncMessage: string | null;
  displayRemainingSeconds: number;
  refreshAll: () => Promise<void>;
  start: () => Promise<void>;
  pause: () => Promise<void>;
  reset: () => Promise<void>;
  switchMode: (mode: PomodoroMode) => Promise<void>;
  updateSettings: (input: {
    focusDurationSeconds: number;
    shortBreakDurationSeconds: number;
    longBreakDurationSeconds: number;
  }) => Promise<void>;
};

type ConflictDetails = {
  state?: PomodoroState;
};

const STATE_POLL_INTERVAL_MS = 4000;
const HISTORY_POLL_INTERVAL_MS = 10000;

export function usePomodoro(token: string | null): UsePomodoroResult {
  const [state, setState] = useState<PomodoroState | null>(null);
  const [history, setHistory] = useState<PomodoroSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [tick, setTick] = useState(Date.now());

  const refreshState = useCallback(async () => {
    if (!token) {
      return;
    }
    const response = await pomodoroApi.fetchState(token);
    setState(response.state);
  }, [token]);

  const refreshHistory = useCallback(async () => {
    if (!token) {
      return;
    }
    const response = await pomodoroApi.fetchHistory(token, 50);
    setHistory(response.sessions);
  }, [token]);

  const refreshAll = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const [stateResponse, historyResponse] = await Promise.all([
        pomodoroApi.fetchState(token),
        pomodoroApi.fetchHistory(token, 50),
      ]);
      setState(stateResponse.state);
      setHistory(historyResponse.sessions);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("同步状态失败");
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    setLoading(true);
    setState(null);
    setHistory([]);
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!token) {
      return;
    }
    const stateTimer = window.setInterval(() => {
      void refreshState().catch(() => undefined);
    }, STATE_POLL_INTERVAL_MS);
    const historyTimer = window.setInterval(() => {
      void refreshHistory().catch(() => undefined);
    }, HISTORY_POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(stateTimer);
      window.clearInterval(historyTimer);
    };
  }, [token, refreshState, refreshHistory]);

  useEffect(() => {
    if (!token) {
      return;
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshAll();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [token, refreshAll]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTick(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const displayRemainingSeconds = useMemo(() => {
    if (!state) {
      return 0;
    }
    if (state.status !== "running" || !state.startedAt) {
      return state.remainingSeconds;
    }
    const startedMs = Date.parse(state.startedAt);
    const elapsed = Math.max(0, Math.floor((tick - startedMs) / 1000));
    return Math.max(0, state.remainingSeconds - elapsed);
  }, [state, tick]);

  const handleActionError = useCallback((err: unknown) => {
    if (!(err instanceof ApiError)) {
      setError("操作失败，请稍后重试");
      return;
    }

    if (err.code === "state_conflict") {
      const details = (err.details ?? {}) as ConflictDetails;
      if (details.state) {
        setState(details.state);
      }
      setSyncMessage("检测到其他设备更新，已同步为最新状态");
      return;
    }

    setError(err.message);
  }, []);

  const applyStateAction = useCallback(
    async (action: (baseVersion: number) => Promise<{ state: PomodoroState }>) => {
      if (!token || !state) {
        return;
      }
      setActionLoading(true);
      setError(null);
      setSyncMessage(null);
      try {
        const response = await action(state.version);
        setState(response.state);
        await refreshHistory();
      } catch (err) {
        handleActionError(err);
      } finally {
        setActionLoading(false);
      }
    },
    [token, state, refreshHistory, handleActionError],
  );

  const start = useCallback(async () => {
    if (!token) {
      return;
    }
    await applyStateAction((baseVersion) => pomodoroApi.startTimer(token, baseVersion));
  }, [token, applyStateAction]);

  const pause = useCallback(async () => {
    if (!token) {
      return;
    }
    await applyStateAction((baseVersion) => pomodoroApi.pauseTimer(token, baseVersion));
  }, [token, applyStateAction]);

  const reset = useCallback(async () => {
    if (!token) {
      return;
    }
    await applyStateAction((baseVersion) => pomodoroApi.resetTimer(token, baseVersion));
  }, [token, applyStateAction]);

  const switchMode = useCallback(
    async (mode: PomodoroMode) => {
      if (!token) {
        return;
      }
      await applyStateAction((baseVersion) => pomodoroApi.switchMode(token, mode, baseVersion));
    },
    [token, applyStateAction],
  );

  const updateSettings = useCallback(
    async (input: {
      focusDurationSeconds: number;
      shortBreakDurationSeconds: number;
      longBreakDurationSeconds: number;
    }) => {
      if (!token) {
        return;
      }
      await applyStateAction((baseVersion) =>
        pomodoroApi.updateSettings(token, {
          baseVersion,
          ...input,
        }),
      );
    },
    [token, applyStateAction],
  );

  return {
    state,
    history,
    loading,
    actionLoading,
    error,
    syncMessage,
    displayRemainingSeconds,
    refreshAll,
    start,
    pause,
    reset,
    switchMode,
    updateSettings,
  };
}
