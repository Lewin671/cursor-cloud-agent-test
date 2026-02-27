import type { PomodoroState } from "../types";

type Props = {
  state: PomodoroState;
  displayRemainingSeconds: number;
  actionLoading: boolean;
  onStart: () => Promise<void>;
  onPause: () => Promise<void>;
  onReset: () => Promise<void>;
};

const statusMap: Record<PomodoroState["status"], string> = {
  idle: "未开始",
  running: "进行中",
  paused: "已暂停",
};

function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60)
    .toString()
    .padStart(2, "0");
  const secs = Math.floor(safe % 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}`;
}

export function TimerCard({
  state,
  displayRemainingSeconds,
  actionLoading,
  onStart,
  onPause,
  onReset,
}: Props) {
  return (
    <section className="timer-card">
      <h2>{formatTime(displayRemainingSeconds)}</h2>
      <p className="subtle">状态：{statusMap[state.status]}</p>
      <p className="subtle">同步版本：v{state.version}</p>

      <div className="control-row">
        <button type="button" onClick={() => void onStart()} disabled={actionLoading}>
          {state.status === "paused" ? "继续" : "开始"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => void onPause()}
          disabled={actionLoading || state.status !== "running"}
        >
          暂停
        </button>
        <button type="button" className="secondary" onClick={() => void onReset()} disabled={actionLoading}>
          重置
        </button>
      </div>
    </section>
  );
}
