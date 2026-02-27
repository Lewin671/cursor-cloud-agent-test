import { FormEvent, useState } from "react";

type Props = {
  loading: boolean;
  error: string | null;
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (email: string, password: string) => Promise<void>;
};

export function AuthForm({ loading, error, onLogin, onRegister }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === "login") {
      await onLogin(email, password);
      return;
    }
    await onRegister(email, password);
  };

  return (
    <div className="auth-card">
      <h1>Pomodoro Sync</h1>
      <p className="subtle">支持跨设备同步的番茄时间应用</p>

      <div className="tab-switch">
        <button
          className={mode === "login" ? "active" : ""}
          onClick={() => setMode("login")}
          type="button"
        >
          登录
        </button>
        <button
          className={mode === "register" ? "active" : ""}
          onClick={() => setMode("register")}
          type="button"
        >
          注册
        </button>
      </div>

      <form onSubmit={handleSubmit} className="auth-form">
        <label>
          邮箱
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
          />
        </label>
        <label>
          密码（至少 6 位）
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={6}
          />
        </label>

        {error ? <p className="error-text">{error}</p> : null}

        <button type="submit" disabled={loading}>
          {loading ? "处理中..." : mode === "login" ? "登录" : "注册"}
        </button>
      </form>
    </div>
  );
}
