import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError } from 'axios';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { paths } from '../../routes';
import { makeUser } from '../../test/factories';
import { apiError } from '../../test/apiError';
import { renderWithAuth, type RenderOptions } from '../../test/renderWithProviders';
import { LoginPage } from './LoginPage';

/** Sign-in: validation, the API's one generic refusal, and where it lands. */

describe('LoginPage', () => {
  it('asks for both fields before calling the API', async () => {
    const signIn = vi.fn();
    renderLogin({ signIn });

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('signs in and lands on the home page', async () => {
    const signIn = vi.fn().mockResolvedValue(makeUser());
    renderLogin({ signIn });

    await signInAs('jordan.lee@acme.inc', 'correct horse battery');

    expect(signIn).toHaveBeenCalledWith('jordan.lee@acme.inc', 'correct horse battery');
    expect(await screen.findByText('home page')).toBeInTheDocument();
  });

  it('returns the user to the page they originally asked for', async () => {
    const signIn = vi.fn().mockResolvedValue(makeUser());
    renderLogin({
      signIn,
      route: { pathname: paths.login, state: { from: { pathname: paths.myTickets } } },
    });

    await signInAs('jordan.lee@acme.inc', 'correct horse battery');

    expect(await screen.findByText('my tickets page')).toBeInTheDocument();
  });

  it('shows the API refusal without guessing which field was wrong', async () => {
    // One message covers a wrong email and a wrong password, so the screen
    // must not attach it to an input and imply which one it was.
    const signIn = vi.fn().mockRejectedValue(
      apiError(401, { detail: 'Incorrect email or password.', code: 'INVALID_CREDENTIALS' }),
    );
    renderLogin({ signIn });

    await signInAs('jordan.lee@acme.inc', 'wrong password');

    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
    expect(screen.queryByText('home page')).not.toBeInTheDocument();
  });

  it('explains a network failure rather than showing a bare error', async () => {
    const signIn = vi.fn().mockRejectedValue(new AxiosError('Network Error'));
    renderLogin({ signIn });

    await signInAs('jordan.lee@acme.inc', 'correct horse battery');

    expect(await screen.findByText(/Could not reach the server/)).toBeInTheDocument();
  });

  it('shows the notice another screen sent it here with', async () => {
    renderLogin({
      route: {
        pathname: paths.login,
        state: { notice: 'Password changed. Please sign in again.' },
      },
    });

    expect(
      await screen.findByText('Password changed. Please sign in again.'),
    ).toBeInTheDocument();
  });

  it('sends an already signed-in visitor away from the form', () => {
    renderLogin({ user: makeUser(), status: 'authenticated' });

    expect(screen.getByText('home page')).toBeInTheDocument();
  });
});

/** Fill the form and submit it. */
async function signInAs(email: string, password: string): Promise<void> {
  await userEvent.type(screen.getByLabelText('Email'), email);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

/** Render the login screen with somewhere to land. */
function renderLogin(options: RenderOptions = {}) {
  return renderWithAuth(
    <Routes>
      <Route path={paths.login} element={<LoginPage />} />
      <Route path={paths.home} element={<span>home page</span>} />
      <Route path={paths.myTickets} element={<span>my tickets page</span>} />
    </Routes>,
    { route: paths.login, ...options },
  );
}
