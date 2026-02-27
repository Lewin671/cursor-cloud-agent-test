import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as authApi from "../api/auth";
import { ApiError } from "../api/client";
import type { User } from "../types";

type AuthContextValue = {
  token: string | null;
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  clearError: () => void;
};

const TOKEN_KEY = "pomodoro_token";
const USER_KEY = "pomodoro_user";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    const storedUser = localStorage.getItem(USER_KEY);
    if (storedToken) {
      setToken(storedToken);
    }
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser) as User);
      } catch {
        localStorage.removeItem(USER_KEY);
      }
    }
  }, []);

  const saveAuth = useCallback((nextToken: string, nextUser: User) => {
    localStorage.setItem(TOKEN_KEY, nextToken);
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = await authApi.login({ email, password });
        saveAuth(result.token, result.user);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("登录失败，请稍后重试");
        }
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [saveAuth],
  );

  const register = useCallback(
    async (email: string, password: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = await authApi.register({ email, password });
        saveAuth(result.token, result.user);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("注册失败，请稍后重试");
        }
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [saveAuth],
  );

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    setError(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo(
    () => ({
      token,
      user,
      loading,
      error,
      login,
      register,
      logout,
      clearError,
    }),
    [token, user, loading, error, login, register, logout, clearError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
