import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link as RouterLink, useNavigate } from 'react-router-dom';

import { register as registerAccount } from '../../api/auth';
import { useAuth } from '../../auth/AuthContext';
import { paths } from '../../routes';
import { AuthCard } from './AuthCard';
import type { LoginLocationState } from './LoginPage';
import { applyApiErrors } from './formErrors';
import { ALLOWED_EMAIL_DOMAIN, MIN_PASSWORD_LENGTH, registerSchema, type RegisterValues } from './schemas';

/**
 * Self-registration, which always produces an EMPLOYEE account.
 *
 * The API issues no tokens here, so the screen signs the new account in
 * immediately afterwards — two requests, one step for the user. If that second
 * request fails the account still exists, so the fallback is the login screen
 * with a note rather than an error that implies nothing happened.
 */
export function RegisterPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register: field,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { full_name: '', email: '', password: '', confirm_password: '' },
  });

  async function onSubmit(values: RegisterValues): Promise<void> {
    setFormError(null);
    try {
      await registerAccount({
        email: values.email,
        full_name: values.full_name,
        password: values.password,
      });
    } catch (error) {
      setFormError(
        applyApiErrors<RegisterValues>(
          error,
          'Could not create your account. Please try again.',
          ['email', 'full_name', 'password'],
          setError,
        ),
      );
      return;
    }

    try {
      await signIn(values.email, values.password);
      void navigate(paths.home, { replace: true });
    } catch {
      const state: LoginLocationState = {
        notice: 'Your account was created. Please sign in.',
      };
      void navigate(paths.login, { replace: true, state });
    }
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle={`Open to @${ALLOWED_EMAIL_DOMAIN} addresses. New accounts start as employees.`}
      footer={
        <Typography variant="body2">
          Already have an account?{' '}
          <Link component={RouterLink} to={paths.login}>
            Sign in
          </Link>
        </Typography>
      }
    >
      <form onSubmit={(event) => void handleSubmit(onSubmit)(event)} noValidate>
        <Stack spacing={2.5}>
          {formError ? <Alert severity="error">{formError}</Alert> : null}

          <TextField
            {...field('full_name')}
            label="Full name"
            autoComplete="name"
            autoFocus
            error={Boolean(errors.full_name)}
            helperText={errors.full_name?.message}
          />

          <TextField
            {...field('email')}
            label="Work email"
            type="email"
            autoComplete="username"
            error={Boolean(errors.email)}
            helperText={errors.email?.message ?? `For example: jordan.lee@${ALLOWED_EMAIL_DOMAIN}`}
          />

          <TextField
            {...field('password')}
            label="Password"
            type="password"
            autoComplete="new-password"
            error={Boolean(errors.password)}
            helperText={errors.password?.message ?? `At least ${MIN_PASSWORD_LENGTH} characters.`}
          />

          <TextField
            {...field('confirm_password')}
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            error={Boolean(errors.confirm_password)}
            helperText={errors.confirm_password?.message}
          />

          <Button type="submit" variant="contained" size="large" disabled={isSubmitting}>
            {isSubmitting ? 'Creating your account…' : 'Create account'}
          </Button>
        </Stack>
      </form>
    </AuthCard>
  );
}
