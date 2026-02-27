import { AuthForm } from "./components/AuthForm";
import { HistoryList } from "./components/HistoryList";
import { ModeSelector } from "./components/ModeSelector";
import { SettingsPanel } from "./components/SettingsPanel";
import { TimerCard } from "./components/TimerCard";
import { useAuth } from "./hooks/useAuth";
import { usePomodoro } from "./hooks/usePomodoro";

function App() {
  const auth = useAuth();
  const pomodoro = usePomodoro(auth.token);

  if (!auth.token || !auth.user) {
    return (
      <main className="auth-layout">
        <AuthForm
          loading={auth.loading}
          error={auth.error}
          onLogin={auth.login}
          onRegister={auth.register}
        />
      </main>
    );
  }

  if (pomodoro.loading || !pomodoro.state) {
    return (
      <main className="app-layout">
        <p>同步中...</p>
      </main>
    );
  }

  return (
    <main className="app-layout">
      <header className="top-bar">
        <div>
          <h1>Pomodoro Sync</h1>
          <p className="subtle">{auth.user.email}</p>
        </div>
        <button type="button" className="secondary" onClick={auth.logout}>
          退出登录
        </button>
      </header>

      <ModeSelector
        currentMode={pomodoro.state.mode}
        disabled={pomodoro.actionLoading}
        onSwitch={pomodoro.switchMode}
      />

      <TimerCard
        state={pomodoro.state}
        displayRemainingSeconds={pomodoro.displayRemainingSeconds}
        actionLoading={pomodoro.actionLoading}
        onStart={pomodoro.start}
        onPause={pomodoro.pause}
        onReset={pomodoro.reset}
      />

      {pomodoro.error ? <p className="error-text">{pomodoro.error}</p> : null}
      {pomodoro.syncMessage ? <p className="info-text">{pomodoro.syncMessage}</p> : null}

      <SettingsPanel
        key={`${pomodoro.state.version}-${pomodoro.state.focusDurationSeconds}-${pomodoro.state.shortBreakDurationSeconds}-${pomodoro.state.longBreakDurationSeconds}`}
        state={pomodoro.state}
        actionLoading={pomodoro.actionLoading}
        onSave={pomodoro.updateSettings}
      />
      <HistoryList sessions={pomodoro.history} />
    </main>
  );
}

export default App;
