import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link as RouterLink, Navigate, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthContext';
import { paths } from '../../routes';
import { AuthCard } from './AuthCard';
import { applyApiErrors } from './formErrors';
import { loginSchema, type LoginValues } from './schemas';

/**
 * Navigation state this screen understands.
 *
 * `from` is set by `RequireAuth` when it turns away a deep link; `notice` by
 * the screens that send a user here with something to say, such as
 * "Password changed. Please sign in again."
 */
export interface LoginLocationState {
  from?: { pathname: string };
  notice?: string;
}

/** Sign-in screen. */
/**
 * Where to go once signed in, ignoring a `from` that points at the
 * change-password screen.
 *
 * `RequireAuth` records the page you were on so a deep link survives signing
 * in. That is right for every page but one. Changing a password revokes every
 * session, so the app goes anonymous *while still on* `/change-password`, and
 * the guard dutifully records it as the page to return to. Signing in then
 * sent the user straight back — and because that route sets `skipPasswordGate`
 * it rendered happily even though the flag had just been cleared. Correct
 * password, correct API response, and an endless loop between two screens.
 *
 * The gate still sends a genuinely-flagged account to the same screen on the
 * next render, so nothing is lost by refusing it as a destination here.
 */
function destinationAfterSignIn(from: string | undefined): string {
  if (!from || from === paths.changePassword) {
    return paths.home;
  }
  return from;
}

export function LoginPage() {
  const { signIn, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LoginLocationState | null;
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register: field,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  // Someone who is already signed in has no business on the login screen —
  // for instance after pressing Back following a successful sign-in.
  if (status === 'authenticated') {
    return <Navigate to={destinationAfterSignIn(state?.from?.pathname)} replace />;
  }

  async function onSubmit(values: LoginValues): Promise<void> {
    setFormError(null);
    try {
      await signIn(values.email, values.password);
      // The guard sends a gated account on to the password screen; going to
      // the requested page here keeps the deep link working for everyone else.
      void navigate(destinationAfterSignIn(state?.from?.pathname), { replace: true });
    } catch (error) {
      setFormError(
        applyApiErrors<LoginValues>(
          error,
          'Could not sign you in. Please try again.',
          ['email', 'password'],
          setError,
        ),
      );
    }
  }

  return (
    <AuthCard
      title="Sign in"
      subtitle="Report a workplace issue, or pick up where you left off."
      footer={
        <Typography variant="body2">
          No account yet?{' '}
          <Link component={RouterLink} to={paths.register}>
            Create one with your ACME address
          </Link>
        </Typography>
      }
    >
      <form onSubmit={(event) => void handleSubmit(onSubmit)(event)} noValidate>
        <Stack spacing={2.5}>
          {state?.notice ? <Alert severity="success">{state.notice}</Alert> : null}
          {formError ? <Alert severity="error">{formError}</Alert> : null}

          <TextField
            {...field('email')}
            label="Email"
            type="email"
            autoComplete="username"
            autoFocus
            error={Boolean(errors.email)}
            helperText={errors.email?.message}
          />

          <TextField
            {...field('password')}
            label="Password"
            type="password"
            autoComplete="current-password"
            error={Boolean(errors.password)}
            helperText={errors.password?.message}
          />

          <Button type="submit" variant="contained" size="large" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </Stack>
      </form>
    </AuthCard>
  );
}
