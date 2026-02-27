import { useState, type FormEvent } from "react";
import type { PomodoroState } from "../types";

type Props = {
  state: PomodoroState;
  actionLoading: boolean;
  onSave: (input: {
    focusDurationSeconds: number;
    shortBreakDurationSeconds: number;
    longBreakDurationSeconds: number;
  }) => Promise<void>;
};

export function SettingsPanel({ state, actionLoading, onSave }: Props) {
  const [focusMinutes, setFocusMinutes] = useState(Math.floor(state.focusDurationSeconds / 60));
  const [shortBreakMinutes, setShortBreakMinutes] = useState(Math.floor(state.shortBreakDurationSeconds / 60));
  const [longBreakMinutes, setLongBreakMinutes] = useState(Math.floor(state.longBreakDurationSeconds / 60));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSave({
      focusDurationSeconds: focusMinutes * 60,
      shortBreakDurationSeconds: shortBreakMinutes * 60,
      longBreakDurationSeconds: longBreakMinutes * 60,
    });
  };

  return (
    <section className="panel">
      <h3>计时设置</h3>
      <form className="settings-grid" onSubmit={handleSubmit}>
        <label>
          专注（分钟）
          <input
            type="number"
            min={1}
            value={focusMinutes}
            onChange={(event) => setFocusMinutes(Number(event.target.value))}
          />
        </label>
        <label>
          短休息（分钟）
          <input
            type="number"
            min={1}
            value={shortBreakMinutes}
            onChange={(event) => setShortBreakMinutes(Number(event.target.value))}
          />
        </label>
        <label>
          长休息（分钟）
          <input
            type="number"
            min={1}
            value={longBreakMinutes}
            onChange={(event) => setLongBreakMinutes(Number(event.target.value))}
          />
        </label>
        <button type="submit" disabled={actionLoading}>
          保存设置
        </button>
      </form>
    </section>
  );
}
