import { apiClient } from './client';
import type { MeResponse, MessageResponse, RegisterResponse, TokenResponse } from './types';

/**
 * The authentication endpoints, one function each.
 *
 * `refreshSession` is the exception: it lives in `client.ts`, because the 401
 * interceptor has to call it and both have to share one in-flight request.
 */

export interface RegisterPayload {
  email: string;
  full_name: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface ChangePasswordPayload {
  current_password: string;
  new_password: string;
}

/** Create an EMPLOYEE account. Issues no tokens — the client then signs in. */
export async function register(payload: RegisterPayload): Promise<RegisterResponse> {
  const { data } = await apiClient.post<RegisterResponse>('/auth/register', payload);
  return data;
}

/** Exchange credentials for an access token and a refresh cookie. */
export async function login(payload: LoginPayload): Promise<TokenResponse> {
  const { data } = await apiClient.post<TokenResponse>('/auth/login', payload);
  return data;
}

/** Revoke the current refresh token and clear its cookie. Never fails. */
export async function logout(): Promise<MessageResponse> {
  const { data } = await apiClient.post<MessageResponse>('/auth/logout');
  return data;
}

/**
 * Replace the caller's password.
 *
 * The API revokes every session and clears the cookie, so the caller signs in
 * again afterwards. That is what makes this safe to reach while
 * `must_change_password` is set.
 */
export async function changePassword(
  payload: ChangePasswordPayload,
): Promise<MessageResponse> {
  const { data } = await apiClient.post<MessageResponse>('/auth/change-password', payload);
  return data;
}

/**
 * Fetch the caller's own record, engineer profile included.
 *
 * Login and refresh return a plain `UserRead`, which has no engineer profile,
 * and the navigation needs the engineer's **level** — only LEADs see Team,
 * only SENIOR and LEAD see Unassigned. So every route into a session ends with
 * this call.
 */
export async function fetchMe(): Promise<MeResponse> {
  const { data } = await apiClient.get<MeResponse>('/auth/me');
  return data;
}
