import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  apiClient,
  clearAccessToken,
  getAccessToken,
  refreshSession,
  setAccessToken,
  setSessionEndedHandler,
} from './client';

/**
 * The session rules that live in `client.ts`: attaching the token, refreshing
 * once on a 401, replaying the request, and never refreshing twice at a time.
 *
 * HTTP is intercepted with axios's own adapter hook rather than a mocking
 * library, so the interceptors under test run exactly as they do in the
 * browser. The bare `axios.post` in `requestRefresh` reads the *global*
 * defaults, while `apiClient` has its own, hence the two assignments.
 */

/** Requests the adapter saw, in order. */
let seen: InternalAxiosRequestConfig[] = [];

/** Queued replies, consumed one per request. */
let replies: ((config: InternalAxiosRequestConfig) => Promise<AxiosResponse>)[] = [];

const adapter: AxiosAdapter = (config) => {
  seen.push(config);
  const next = replies.shift();
  if (!next) {
    throw new Error(`Unexpected request to ${String(config.url)}`);
  }
  return next(config);
};

const originalApiAdapter = apiClient.defaults.adapter;
const originalGlobalAdapter = axios.defaults.adapter;

beforeEach(() => {
  seen = [];
  replies = [];
  clearAccessToken();
  setSessionEndedHandler(null);
  apiClient.defaults.adapter = adapter;
  axios.defaults.adapter = adapter;
});

afterEach(() => {
  apiClient.defaults.adapter = originalApiAdapter;
  axios.defaults.adapter = originalGlobalAdapter;
});

describe('access token handling', () => {
  it('sends no Authorization header when signed out', async () => {
    replies.push((config) => Promise.resolve(ok(config, { items: [] })));

    await apiClient.get('/incidents');

    expect(seen[0].headers.Authorization).toBeUndefined();
  });

  it('attaches the stored token as a bearer header', async () => {
    setAccessToken('token-abc');
    replies.push((config) => Promise.resolve(ok(config, { items: [] })));

    await apiClient.get('/incidents');

    expect(seen[0].headers.Authorization).toBe('Bearer token-abc');
  });
});

describe('refreshing on a 401', () => {
  it('refreshes once and replays the request with the new token', async () => {
    setAccessToken('expired');
    replies.push(
      (config) => Promise.reject(unauthorised(config)),
      (config) => Promise.resolve(ok(config, tokenResponse('fresh'))),
      (config) => Promise.resolve(ok(config, { id: 'INC-1' })),
    );

    const response = await apiClient.get('/incidents/1');

    expect(response.data).toEqual({ id: 'INC-1' });
    expect(seen.map((config) => config.url)).toEqual([
      '/incidents/1',
      '/api/v1/auth/refresh',
      '/incidents/1',
    ]);
    expect(seen[2].headers.Authorization).toBe('Bearer fresh');
    expect(getAccessToken()).toBe('fresh');
  });

  it('gives up when the refresh itself is refused', async () => {
    const sessionEnded = vi.fn();
    setSessionEndedHandler(sessionEnded);
    setAccessToken('expired');
    replies.push(
      (config) => Promise.reject(unauthorised(config)),
      (config) => Promise.reject(unauthorised(config)),
    );

    await expect(apiClient.get('/incidents/1')).rejects.toThrow();

    expect(seen).toHaveLength(2);
    expect(getAccessToken()).toBeNull();
    expect(sessionEnded).toHaveBeenCalledOnce();
  });

  it('retries a request only once, so a stubborn 401 cannot loop', async () => {
    setAccessToken('expired');
    replies.push(
      (config) => Promise.reject(unauthorised(config)),
      (config) => Promise.resolve(ok(config, tokenResponse('fresh'))),
      (config) => Promise.reject(unauthorised(config)),
    );

    await expect(apiClient.get('/incidents/1')).rejects.toThrow();

    expect(seen).toHaveLength(3);
  });

  it('does not try to refresh a rejected sign-in', async () => {
    replies.push((config) => Promise.reject(unauthorised(config)));

    await expect(apiClient.post('/auth/login', {})).rejects.toThrow();

    expect(seen.map((config) => config.url)).toEqual(['/auth/login']);
  });

  it('leaves a 403 alone — the token is fine, the permission is not', async () => {
    setAccessToken('good');
    replies.push((config) => Promise.reject(forbidden(config)));

    await expect(apiClient.get('/users')).rejects.toThrow();

    expect(seen).toHaveLength(1);
    expect(getAccessToken()).toBe('good');
  });
});

describe('concurrent refreshes', () => {
  it('shares one refresh request between every caller', async () => {
    // Refresh rotates the cookie and treats a replayed token as theft by
    // revoking every session, so two parallel refreshes would sign the user
    // out. StrictMode's double-invoked bootstrap effect is the common case.
    setAccessToken('expired');
    replies.push(
      (config) => Promise.reject(unauthorised(config)),
      (config) => Promise.reject(unauthorised(config)),
      (config) => delayed(ok(config, tokenResponse('fresh'))),
      (config) => Promise.resolve(ok(config, { id: 'one' })),
      (config) => Promise.resolve(ok(config, { id: 'two' })),
    );

    const [first, second] = await Promise.all([
      apiClient.get('/incidents/one'),
      apiClient.get('/incidents/two'),
    ]);

    expect(first.data).toEqual({ id: 'one' });
    expect(second.data).toEqual({ id: 'two' });
    expect(seen.filter((config) => config.url === '/api/v1/auth/refresh')).toHaveLength(1);
  });

  it('starts a fresh request once the previous refresh has settled', async () => {
    replies.push(
      (config) => Promise.resolve(ok(config, tokenResponse('first'))),
      (config) => Promise.resolve(ok(config, tokenResponse('second'))),
    );

    await refreshSession();
    await refreshSession();

    expect(seen).toHaveLength(2);
    expect(getAccessToken()).toBe('second');
  });

  it('answers null rather than throwing when there is no live session', async () => {
    replies.push((config) => Promise.reject(unauthorised(config)));

    await expect(refreshSession()).resolves.toBeNull();
  });
});

/** Build a successful response for `config`. */
function ok(config: InternalAxiosRequestConfig, data: unknown): AxiosResponse {
  return { data, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config };
}

/** Build a 401 rejection for `config`. */
function unauthorised(config: InternalAxiosRequestConfig): AxiosError {
  return errorFor(config, 401, { detail: 'Sign in to continue.', code: 'MISSING_TOKEN' });
}

/** Build a 403 rejection for `config`. */
function forbidden(config: InternalAxiosRequestConfig): AxiosError {
  return errorFor(config, 403, { detail: 'Not permitted.', code: 'ROLE_NOT_PERMITTED' });
}

function errorFor(
  config: InternalAxiosRequestConfig,
  status: number,
  data: unknown,
): AxiosError {
  const response: AxiosResponse = {
    data,
    status,
    statusText: 'Error',
    headers: new AxiosHeaders(),
    config,
  };
  return new AxiosError('Request failed', String(status), config, null, response);
}

/** A reply that resolves on a later tick, so callers really do overlap. */
function delayed(response: AxiosResponse): Promise<AxiosResponse> {
  return new Promise((resolve) => setTimeout(() => resolve(response), 5));
}

/** The body `POST /auth/refresh` returns. */
function tokenResponse(accessToken: string) {
  return {
    access_token: accessToken,
    token_type: 'bearer',
    user: { id: 'u1', email: 'jordan.lee@acme.inc', role: 'EMPLOYEE' },
  };
}
