import type { AuthResponse } from "../types";
import { request } from "./client";

type AuthInput = {
  email: string;
  password: string;
};

export function register(input: AuthInput): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/register", {
    method: "POST",
    body: input,
  });
}

export function login(input: AuthInput): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/login", {
    method: "POST",
    body: input,
  });
}
