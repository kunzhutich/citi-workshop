import { createTheme, ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

import type { CurrentUser } from '../api/types';
import { AuthContext, type AuthContextValue, type AuthStatus } from '../auth/AuthContext';
import { SnackbarProvider } from '../components/SnackbarProvider';
import { theme } from '../theme';

/**
 * The application's theme with every transition instant.
 *
 * jsdom has no compositor, so a Material UI transition is a *timer* there and
 * nothing else — 225ms of real waiting that renders nothing. R5 wrapped the
 * report questionnaire's five sections in `Collapse`, and a test that clicks
 * through all of them went from instant to about a second of pure sleeping.
 * Alone that still passed; in a thirty-five-file parallel run it tipped past
 * Vitest's 5s default and three tests failed intermittently, which is the
 * worst way for a suite to tell you something.
 *
 * Zeroing the durations rather than raising the timeout, because the timeout
 * is not the problem: the suite should not be waiting for animations it cannot
 * see. `Collapse` still mounts, unmounts and fires `onEntered` — the behaviour
 * the tests are about — it just does it immediately.
 *
 * This is also what a reader with `prefers-reduced-motion` gets, so it is not
 * a fiction invented for tests.
 */
const testTheme = createTheme(theme, {
  transitions: { duration: { shortest: 0, shorter: 0, short: 0, standard: 0, complex: 0, enteringScreen: 0, leavingScreen: 0 } },
});

/**
 * Render helpers for component tests.
 *
 * `renderWithAuth` supplies the auth context directly instead of running
 * `AuthProvider`, so a test of a guard or of the shell states the session it
 * wants in one line and never touches HTTP. `AuthProvider`'s own behaviour is
 * tested against it separately, in `AuthProvider.test.tsx`.
 */

export interface AuthOptions {
  user?: CurrentUser | null;
  status?: AuthStatus;
  signIn?: AuthContextValue['signIn'];
  signOut?: AuthContextValue['signOut'];
  changeOwnPassword?: AuthContextValue['changeOwnPassword'];
}

/**
 * An entry in the router's history.
 *
 * The object form is how a test supplies navigation state — the `notice` the
 * change-password screen hands to the login screen, for instance.
 */
export type TestRoute = string | { pathname: string; state?: unknown };

export interface RenderOptions extends AuthOptions {
  /** Initial history entry, for tests that depend on the current route. */
  route?: TestRoute;
}

/** Build an auth context value, defaulting to a signed-in employee. */
export function makeAuthValue({
  user = null,
  status,
  signIn = vi.fn(),
  signOut = vi.fn(),
  changeOwnPassword = vi.fn(),
}: AuthOptions = {}): AuthContextValue {
  return {
    user,
    status: status ?? (user ? 'authenticated' : 'anonymous'),
    signIn,
    signOut,
    changeOwnPassword,
  };
}

/** Render `ui` inside the theme, a router and a stubbed session. */
export function renderWithAuth(ui: ReactElement, options: RenderOptions = {}): RenderResult {
  const { route = '/', ...authOptions } = options;
  const auth = makeAuthValue(authOptions);

  return render(
    <Providers route={route}>
      <AuthContext value={auth}>{ui}</AuthContext>
    </Providers>,
  );
}

/** Render `ui` with everything except a session — for `AuthProvider` itself. */
export function renderWithProviders(ui: ReactElement, route: TestRoute = '/'): RenderResult {
  return render(<Providers route={route}>{ui}</Providers>);
}

function Providers({ children, route }: { children: ReactNode; route: TestRoute }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={testTheme}>
        <MemoryRouter initialEntries={[route]}>
          {/* Real, not stubbed: a screen that confirms something through the
              snackbar should have that assertion available to its test. */}
          <SnackbarProvider>{children}</SnackbarProvider>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
