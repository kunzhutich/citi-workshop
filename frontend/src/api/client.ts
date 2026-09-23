import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';

import type { TokenResponse } from './types';

/**
 * The HTTP client, and the session it carries.
 *
 * One module owns three things that only make sense together: where the access
 * token is kept, how it is attached to requests, and what happens when the API
 * says it has expired. Splitting them would mean three files that each import
 * the other two.
 *
 * Every API path is relative and starts with `/api/v1`. There is deliberately
 * no configurable base URL: the browser always talks to the origin it was
 * served from — CloudFront in the cloud (one distribution fronts both the S3
 * site and the Lambda), the Vite dev server locally. Same-origin in both means
 * no CORS and a working `SameSite=Strict` refresh cookie.
 */
export const API_BASE_URL = '/api/v1';

/** Endpoint whose 401 must never trigger a refresh-and-retry. */
const REFRESH_PATH = '/auth/refresh';

/** Paths where a 401 is the answer, not a stale token. */
const NO_RETRY_PATHS = [REFRESH_PATH, '/auth/login', '/auth/logout'];

/** Extra flag on a retried request, so one 401 can never loop. */
interface RetryableConfig extends InternalAxiosRequestConfig {
  retriedAfterRefresh?: boolean;
}

/**
 * The access token, held **in memory only**.
 *
 * Not `localStorage`, not `sessionStorage`, not a readable cookie: anything
 * persisted is readable by any script that gets onto the page, and survives
 * the tab. A closed tab ends the access token; the `HttpOnly` refresh cookie
 * is what restores the session on the next page load, and JavaScript cannot
 * read that.
 */
let accessToken: string | null = null;

/** Called when a refresh attempt proves there is no live session left. */
let sessionEndedHandler: (() => void) | null = null;

/**
 * The in-flight refresh, if any.
 *
 * Refresh **rotates**: the server revokes the presented token and issues a new
 * one, and presenting an already-revoked token is treated as theft — it
 * revokes every session the user has. Two concurrent refreshes with the same
 * cookie would therefore log the user out. Everything that needs a refresh
 * awaits this one promise instead, which also covers React StrictMode
 * double-invoking the bootstrap effect in development.
 */
let refreshInFlight: Promise<TokenResponse | null> | null = null;

/** The shared axios instance. Use this for every call to the API. */
export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

/** Return the current access token, or null when signed out. */
export function getAccessToken(): string | null {
  return accessToken;
}

/** Store the access token returned by login or refresh. */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** Forget the access token. The refresh cookie is the server's to clear. */
export function clearAccessToken(): void {
  accessToken = null;
}

/**
 * Register the callback fired when the session turns out to be gone.
 *
 * `AuthProvider` uses this to drop the signed-in user after a background
 * request discovers the refresh token has expired or been revoked.
 */
export function setSessionEndedHandler(handler: (() => void) | null): void {
  sessionEndedHandler = handler;
}

/**
 * Rotate the refresh cookie for a new access token.
 *
 * Returns the new token and user, or `null` when there is no live session —
 * a missing or expired cookie is an ordinary answer here, not an error to
 * throw. Concurrent callers share one request; see `refreshInFlight`.
 */
export function refreshSession(): Promise<TokenResponse | null> {
  refreshInFlight ??= requestRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/** Attach the bearer token to every outgoing request that has one. */
apiClient.interceptors.request.use((config) => {
  if (accessToken) {
    const headers = AxiosHeaders.from(config.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);
    config.headers = headers;
  }
  return config;
});

/**
 * On a 401, refresh once and replay the request.
 *
 * Access tokens live 15 minutes, so an open tab hits this routinely. The
 * retry is attempted exactly once per request — `retriedAfterRefresh` is what
 * stops a genuinely unauthorised call from ping-ponging.
 */
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetryableConfig | undefined;

    if (!config || error.response?.status !== 401 || !shouldRetry(config)) {
      return Promise.reject(error);
    }

    const refreshed = await refreshSession();
    if (!refreshed) {
      return Promise.reject(error);
    }

    config.retriedAfterRefresh = true;
    return apiClient.request(config);
  },
);

/** Decide whether a 401 on this request is worth a refresh and a replay. */
function shouldRetry(config: RetryableConfig): boolean {
  if (config.retriedAfterRefresh) {
    return false;
  }
  const path = config.url ?? '';
  return !NO_RETRY_PATHS.some((candidate) => path.startsWith(candidate));
}

/**
 * Perform the refresh call itself.
 *
 * Deliberately bypasses `apiClient` — a 401 here is the end of the session,
 * and routing it through the interceptor that calls this function would be a
 * loop. The cookie is sent because of `withCredentials`, and its narrow
 * `/api/v1/auth` path means it rides on this request and almost nothing else.
 */
async function requestRefresh(): Promise<TokenResponse | null> {
  try {
    const { data } = await axios.post<TokenResponse>(
      `${API_BASE_URL}${REFRESH_PATH}`,
      null,
      { withCredentials: true },
    );
    accessToken = data.access_token;
    return data;
  } catch {
    accessToken = null;
    sessionEndedHandler?.();
    return null;
  }
}
