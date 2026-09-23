import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthContext';
import { paths } from '../../routes';
import { AuthCard } from './AuthCard';
import type { LoginLocationState } from './LoginPage';
import { applyApiErrors } from './formErrors';
import { changePasswordSchema, MIN_PASSWORD_LENGTH, type ChangePasswordValues } from './schemas';

/**
 * Change your own password — and the forced version of the same screen.
 *
 * Accounts an admin creates carry `must_change_password`, and the API answers
 * 403 `PASSWORD_CHANGE_REQUIRED` on every endpoint outside `/auth` until it is
 * cleared. `RequireAuth` routes such a user here and lets them go nowhere
 * else, so this screen has to work while the rest of the app is closed to
 * them: it renders outside `AppShell`, and in forced mode it offers no way
 * out except completing the change.
 *
 * Succeeding ends the session — the API revokes every refresh token in the act
 * — so the screen finishes at the login form rather than pretending the old
 * session survived.
 */
export function ChangePasswordPage() {
  const { user, changeOwnPassword } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const forced = user?.must_change_password ?? false;

  const {
    register: field,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current_password: '', new_password: '', confirm_password: '' },
  });

  async function onSubmit(values: ChangePasswordValues): Promise<void> {
    setFormError(null);
    try {
      await changeOwnPassword(values.current_password, values.new_password);
      const state: LoginLocationState = {
        notice: 'Password changed. Please sign in again.',
      };
      void navigate(paths.login, { replace: true, state });
    } catch (error) {
      setFormError(
        applyApiErrors<ChangePasswordValues>(
          error,
          'Could not change your password. Please try again.',
          ['current_password', 'new_password'],
          setError,
        ),
      );
    }
  }

  return (
    <AuthCard
      title="Change your password"
      subtitle={
        forced
          ? undefined
          : 'Changing your password signs you out of every device, including this one.'
      }
    >
      <form onSubmit={(event) => void handleSubmit(onSubmit)(event)} noValidate>
        <Stack spacing={2.5}>
          {forced ? (
            <Alert severity="info">
              <AlertTitle>Choose your own password to continue</AlertTitle>
              This account was created with a temporary password. Until it is changed, the
              rest of the application is closed to you.
            </Alert>
          ) : null}

          {formError ? <Alert severity="error">{formError}</Alert> : null}

          <TextField
            {...field('current_password')}
            label={forced ? 'Temporary password' : 'Current password'}
            type="password"
            autoComplete="current-password"
            autoFocus
            error={Boolean(errors.current_password)}
            helperText={errors.current_password?.message}
          />

          <TextField
            {...field('new_password')}
            label="New password"
            type="password"
            autoComplete="new-password"
            error={Boolean(errors.new_password)}
            helperText={errors.new_password?.message ?? `At least ${MIN_PASSWORD_LENGTH} characters.`}
          />

          <TextField
            {...field('confirm_password')}
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            error={Boolean(errors.confirm_password)}
            helperText={errors.confirm_password?.message}
          />

          <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1.5}>
            {forced ? null : (
              <Button onClick={() => void navigate(-1)} disabled={isSubmitting} fullWidth>
                Cancel
              </Button>
            )}
            <Button type="submit" variant="contained" size="large" disabled={isSubmitting} fullWidth>
              {isSubmitting ? 'Saving…' : 'Change password'}
            </Button>
          </Stack>
        </Stack>
      </form>
    </AuthCard>
  );
}
