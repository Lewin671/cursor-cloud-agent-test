import type { PomodoroMode } from "../types";

type Props = {
  currentMode: PomodoroMode;
  disabled?: boolean;
  onSwitch: (mode: PomodoroMode) => Promise<void>;
};

const MODES: Array<{ value: PomodoroMode; label: string }> = [
  { value: "focus", label: "专注" },
  { value: "short_break", label: "短休息" },
  { value: "long_break", label: "长休息" },
];

export function ModeSelector({ currentMode, disabled = false, onSwitch }: Props) {
  return (
    <div className="mode-selector">
      {MODES.map((mode) => (
        <button
          key={mode.value}
          type="button"
          className={currentMode === mode.value ? "active" : ""}
          onClick={() => void onSwitch(mode.value)}
          disabled={disabled}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}
