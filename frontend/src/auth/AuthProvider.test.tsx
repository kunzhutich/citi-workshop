import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeEngineer, makeUser } from '../test/factories';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './AuthContext';

/**
 * What `AuthProvider` owns: restoring a session on page load, signing in and
 * out, and reacting when a background request discovers the session is gone.
 *
 * The HTTP layer is mocked here on purpose — the refresh-and-retry rules are
 * tested against real interceptors in `api/client.test.ts`, and repeating them
 * would test axios twice and the provider once.
 */

vi.mock('../api/auth', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
  changePassword: vi.fn(),
  fetchMe: vi.fn(),
}));

vi.mock('../api/client', () => ({
  refreshSession: vi.fn(),
  setAccessToken: vi.fn(),
  clearAccessToken: vi.fn(),
  setSessionEndedHandler: vi.fn(),
}));

const authApi = await import('../api/auth');
const client = await import('../api/client');

const login = vi.mocked(authApi.login);
const logout = vi.mocked(authApi.logout);
const changePassword = vi.mocked(authApi.changePassword);
const fetchMe = vi.mocked(authApi.fetchMe);
const refreshSession = vi.mocked(client.refreshSession);
const setAccessToken = vi.mocked(client.setAccessToken);
const clearAccessToken = vi.mocked(client.clearAccessToken);
const setSessionEndedHandler = vi.mocked(client.setSessionEndedHandler);

const employee = makeUser();
const leadEngineer = makeEngineer('LEAD', { full_name: 'Sam Rivera' });

beforeEach(() => {
  vi.clearAllMocks();
  refreshSession.mockResolvedValue(null);
});

describe('restoring a session on page load', () => {
  it('spends the refresh cookie and loads the full record', async () => {
    refreshSession.mockResolvedValue(session());
    fetchMe.mockResolvedValue({ user: leadEngineer });

    renderProbe();

    expect(await screen.findByTestId('status')).toHaveTextContent('authenticated');
    expect(screen.getByTestId('user')).toHaveTextContent('Sam Rivera');
    // The navigation needs the engineer level, which only /auth/me carries.
    expect(screen.getByTestId('level')).toHaveTextContent('LEAD');
  });

  it('settles as anonymous when there is no live session', async () => {
    refreshSession.mockResolvedValue(null);

    renderProbe();

    expect(await screen.findByTestId('status')).toHaveTextContent('anonymous');
    expect(fetchMe).not.toHaveBeenCalled();
  });

  it('reports loading until the refresh answers', async () => {
    let release: (() => void) | undefined;
    refreshSession.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve(null);
      }),
    );

    renderProbe();

    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    release?.();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
  });

  it('signs out when the record cannot be loaded after a good refresh', async () => {
    refreshSession.mockResolvedValue(session());
    fetchMe.mockRejectedValue(new Error('boom'));

    renderProbe();

    expect(await screen.findByTestId('status')).toHaveTextContent('anonymous');
    expect(clearAccessToken).toHaveBeenCalled();
  });
});

describe('signing in and out', () => {
  it('stores the access token and the caller record', async () => {
    login.mockResolvedValue(session());
    fetchMe.mockResolvedValue({ user: employee });

    renderProbe();
    await screen.findByTestId('status');
    await userEvent.click(screen.getByRole('button', { name: 'sign in' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(setAccessToken).toHaveBeenCalledWith('access-token');
    expect(screen.getByTestId('user')).toHaveTextContent('Jordan Lee');
  });

  it('revokes the session server-side and forgets it here', async () => {
    refreshSession.mockResolvedValue(session());
    fetchMe.mockResolvedValue({ user: employee });
    logout.mockResolvedValue({ detail: 'Signed out.' });

    renderProbe();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    await userEvent.click(screen.getByRole('button', { name: 'sign out' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
    expect(logout).toHaveBeenCalledOnce();
    expect(clearAccessToken).toHaveBeenCalled();
  });

  it('signs out locally even when the logout request fails', async () => {
    refreshSession.mockResolvedValue(session());
    fetchMe.mockResolvedValue({ user: employee });
    logout.mockRejectedValue(new Error('offline'));

    renderProbe();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    await userEvent.click(screen.getByRole('button', { name: 'sign out' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
  });
});

describe('changing your own password', () => {
  it('ends the session, because the API revoked every token', async () => {
    refreshSession.mockResolvedValue(session());
    fetchMe.mockResolvedValue({ user: employee });
    changePassword.mockResolvedValue({ detail: 'Password changed. Please sign in again.' });

    renderProbe();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    await userEvent.click(screen.getByRole('button', { name: 'change password' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
    expect(changePassword).toHaveBeenCalledWith({
      current_password: 'old-password-1',
      new_password: 'new-password-2',
    });
  });
});

describe('losing a session in the background', () => {
  it('drops the user when the HTTP client reports the session ended', async () => {
    refreshSession.mockResolvedValue(session());
    fetchMe.mockResolvedValue({ user: employee });

    renderProbe();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));

    // `client.ts` calls this handler when a refresh proves the cookie is dead.
    const handler = setSessionEndedHandler.mock.calls.at(0)?.[0];
    expect(handler).toBeTypeOf('function');
    handler?.();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
  });
});

/** A `TokenResponse` as login and refresh return it. */
function session() {
  return { access_token: 'access-token', token_type: 'bearer', user: employee };
}

/** Render a probe that shows the session and can act on it. */
function renderProbe() {
  render(
    <AuthProvider>
      <SessionProbe />
    </AuthProvider>,
  );
}

function SessionProbe() {
  const { user, status, signIn, signOut, changeOwnPassword } = useAuth();

  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user?.full_name ?? 'nobody'}</span>
      <span data-testid="level">{user?.engineer_profile?.level ?? 'none'}</span>
      <button onClick={() => void signIn('jordan.lee@acme.inc', 'correct horse battery')}>
        sign in
      </button>
      <button onClick={() => void signOut()}>sign out</button>
      <button onClick={() => void changeOwnPassword('old-password-1', 'new-password-2')}>
        change password
      </button>
    </div>
  );
}
