import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { paths } from '../../routes';
import { apiError } from '../../test/apiError';
import { makeUser } from '../../test/factories';
import { renderWithAuth, type RenderOptions } from '../../test/renderWithProviders';
import { RegisterPage } from './RegisterPage';

/**
 * Self-registration: the `@acme.inc` rule, the confirm field, and what the
 * screen does with the API's answer.
 */

vi.mock('../../api/auth', () => ({ register: vi.fn() }));

const { register } = await import('../../api/auth');
const registerMock = vi.mocked(register);

beforeEach(() => {
  registerMock.mockReset();
});

describe('RegisterPage', () => {
  it('refuses an address outside the ACME domain', async () => {
    renderRegister();

    await fillForm({ email: 'jordan.lee@gmail.com' });

    expect(await screen.findByText('Use your @acme.inc address.')).toBeInTheDocument();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('refuses a subdomain and a lookalike, as the API does', async () => {
    renderRegister();

    await fillForm({ email: 'jordan@sub.acme.inc' });
    expect(await screen.findByText('Use your @acme.inc address.')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Work email'));
    await userEvent.type(screen.getByLabelText('Work email'), 'jordan@acme.inc.evil.com');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Use your @acme.inc address.')).toBeInTheDocument();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('refuses a password shorter than the API accepts', async () => {
    renderRegister();

    await fillForm({ password: 'short', confirm: 'short' });

    expect(await screen.findByText('Use at least 12 characters.')).toBeInTheDocument();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('refuses two passwords that do not match', async () => {
    renderRegister();

    await fillForm({ confirm: 'a different password' });

    expect(await screen.findByText('The two passwords do not match.')).toBeInTheDocument();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('creates the account and signs it in, landing on the home page', async () => {
    registerMock.mockResolvedValue({ user: makeUser() });
    const signIn = vi.fn().mockResolvedValue(makeUser());
    renderRegister({ signIn });

    await fillForm();

    expect(registerMock).toHaveBeenCalledWith({
      email: 'jordan.lee@acme.inc',
      full_name: 'Jordan Lee',
      password: 'correct horse battery',
    });
    expect(signIn).toHaveBeenCalledWith('jordan.lee@acme.inc', 'correct horse battery');
    expect(await screen.findByText('home page')).toBeInTheDocument();
  });

  it('attaches a taken email to the email field', async () => {
    registerMock.mockRejectedValue(
      apiError(409, {
        detail: 'An account with that email already exists.',
        code: 'EMAIL_TAKEN',
        field: 'email',
      }),
    );
    renderRegister();

    await fillForm();

    expect(
      await screen.findByText('An account with that email already exists.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Work email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('maps a FastAPI field error onto its input', async () => {
    registerMock.mockRejectedValue(
      apiError(422, {
        detail: [
          {
            type: 'string_too_short',
            loc: ['body', 'password'],
            msg: 'String should have at least 12 characters',
          },
        ],
      }),
    );
    renderRegister();

    await fillForm();

    expect(
      await screen.findByText('String should have at least 12 characters'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('sends the user to sign in when the account was created but sign-in failed', async () => {
    // The account exists at this point, so an error implying nothing happened
    // would be a lie — and the user would try to register again.
    registerMock.mockResolvedValue({ user: makeUser() });
    const signIn = vi.fn().mockRejectedValue(new Error('network'));
    renderRegister({ signIn });

    await fillForm();

    expect(await screen.findByText('login page')).toBeInTheDocument();
  });
});

interface FormValues {
  name?: string;
  email?: string;
  password?: string;
  confirm?: string;
}

/** Fill every field with a valid value unless the test overrides one. */
async function fillForm({
  name = 'Jordan Lee',
  email = 'jordan.lee@acme.inc',
  password = 'correct horse battery',
  confirm = password,
}: FormValues = {}): Promise<void> {
  await userEvent.type(screen.getByLabelText('Full name'), name);
  await userEvent.type(screen.getByLabelText('Work email'), email);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.type(screen.getByLabelText('Confirm password'), confirm);
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

function renderRegister(options: RenderOptions = {}) {
  return renderWithAuth(
    <Routes>
      <Route path={paths.register} element={<RegisterPage />} />
      <Route path={paths.home} element={<span>home page</span>} />
      <Route path={paths.login} element={<span>login page</span>} />
    </Routes>,
    { route: paths.register, ...options },
  );
}
