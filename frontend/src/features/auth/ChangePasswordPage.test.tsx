import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { paths } from '../../routes';
import { apiError } from '../../test/apiError';
import { makeUser } from '../../test/factories';
import { renderWithAuth, type RenderOptions } from '../../test/renderWithProviders';
import { ChangePasswordPage } from './ChangePasswordPage';
import type { LoginLocationState } from './LoginPage';

/**
 * Changing your own password, and the forced version an admin-created account
 * meets on its first sign-in.
 */

describe('changing your password voluntarily', () => {
  it('offers a way out', () => {
    renderChangePassword({ user: makeUser() });

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByText(/temporary password/i)).not.toBeInTheDocument();
  });

  it('refuses two new passwords that do not match', async () => {
    const changeOwnPassword = vi.fn();
    renderChangePassword({ user: makeUser(), changeOwnPassword });

    await submit({ confirm: 'something else entirely' });

    expect(await screen.findByText('The two passwords do not match.')).toBeInTheDocument();
    expect(changeOwnPassword).not.toHaveBeenCalled();
  });

  it('refuses a new password identical to the current one', async () => {
    const changeOwnPassword = vi.fn();
    renderChangePassword({ user: makeUser(), changeOwnPassword });

    await submit({ current: 'the same password', next: 'the same password' });

    expect(
      await screen.findByText('Choose a password you have not used before.'),
    ).toBeInTheDocument();
    expect(changeOwnPassword).not.toHaveBeenCalled();
  });

  it('ends at the login screen, because the API revoked every session', async () => {
    const changeOwnPassword = vi.fn().mockResolvedValue(undefined);
    renderChangePassword({ user: makeUser(), changeOwnPassword });

    await submit();

    expect(changeOwnPassword).toHaveBeenCalledWith('old password 12', 'brand new password');
    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(screen.getByTestId('notice')).toHaveTextContent(
      'Password changed. Please sign in again.',
    );
  });

  it('attaches a wrong current password to its own field', async () => {
    const changeOwnPassword = vi.fn().mockRejectedValue(
      apiError(422, {
        detail: 'Your current password is incorrect.',
        code: 'INVALID_CURRENT_PASSWORD',
        field: 'current_password',
      }),
    );
    renderChangePassword({ user: makeUser(), changeOwnPassword });

    await submit();

    expect(await screen.findByText('Your current password is incorrect.')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('the forced change', () => {
  const gated = makeUser({ must_change_password: true });

  it('explains why the rest of the app is closed', () => {
    renderChangePassword({ user: gated });

    expect(screen.getByText('Choose your own password to continue')).toBeInTheDocument();
  });

  it('offers no way out but completing it', () => {
    renderChangePassword({ user: gated });

    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('calls the temporary password what it is', () => {
    renderChangePassword({ user: gated });

    expect(screen.getByLabelText('Temporary password')).toBeInTheDocument();
  });

  it('finishes at the login screen like any other change', async () => {
    const changeOwnPassword = vi.fn().mockResolvedValue(undefined);
    renderChangePassword({ user: gated, changeOwnPassword });

    await submit({ currentLabel: 'Temporary password' });

    expect(await screen.findByText('login page')).toBeInTheDocument();
  });
});

interface SubmitValues {
  current?: string;
  next?: string;
  confirm?: string;
  currentLabel?: string;
}

/** Fill the form with valid values unless the test overrides one. */
async function submit({
  current = 'old password 12',
  next = 'brand new password',
  confirm = next,
  currentLabel = 'Current password',
}: SubmitValues = {}): Promise<void> {
  await userEvent.type(screen.getByLabelText(currentLabel), current);
  await userEvent.type(screen.getByLabelText('New password'), next);
  await userEvent.type(screen.getByLabelText('Confirm new password'), confirm);
  await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
}

function renderChangePassword(options: RenderOptions) {
  return renderWithAuth(
    <Routes>
      <Route path={paths.changePassword} element={<ChangePasswordPage />} />
      <Route path={paths.login} element={<LoginStub />} />
    </Routes>,
    { route: paths.changePassword, ...options },
  );
}

/** Stands in for the login screen, showing the notice it was handed. */
function LoginStub() {
  const state = useLocation().state as LoginLocationState | null;
  return (
    <div>
      <span>login page</span>
      <span data-testid="notice">{state?.notice ?? ''}</span>
    </div>
  );
}
