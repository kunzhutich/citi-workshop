import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';

import { makeUser } from '../test/factories';
import { renderWithAuth, type RenderOptions } from '../test/renderWithProviders';
import { paths } from '../routes';
import { RequireAuth } from './RequireAuth';

/**
 * The two rules `RequireAuth` enforces, in the API's own order: no session
 * goes to the login screen, and an account owing a password change goes to the
 * change-password screen and nowhere else.
 */

describe('RequireAuth', () => {
  it('waits while the session is being restored', () => {
    renderGuarded({ status: 'loading', user: null, route: paths.myTickets });

    expect(screen.getByText('Restoring your session…')).toBeInTheDocument();
    expect(screen.queryByText('login screen')).not.toBeInTheDocument();
  });

  it('sends a signed-out visitor to the login screen', () => {
    renderGuarded({ status: 'anonymous', user: null, route: paths.myTickets });

    expect(screen.getByText('login screen')).toBeInTheDocument();
  });

  it('lets a signed-in user through', () => {
    renderGuarded({ user: makeUser(), route: paths.myTickets });

    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('diverts an account that still owes a password change', () => {
    renderGuarded({
      user: makeUser({ must_change_password: true }),
      route: paths.myTickets,
    });

    expect(screen.getByText('change password screen')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('still requires a session on the change-password route', () => {
    renderGuarded({ status: 'anonymous', user: null, route: paths.changePassword });

    expect(screen.getByText('login screen')).toBeInTheDocument();
  });

  it('lets a gated account reach the change-password screen itself', () => {
    // Without the exemption the redirect would point at the very route it is
    // rendered on, and the user would be stuck in a loop.
    renderGuarded({
      user: makeUser({ must_change_password: true }),
      route: paths.changePassword,
    });

    expect(screen.getByText('change password screen')).toBeInTheDocument();
  });
});

/** Render the guard over a route table that names where it landed. */
function renderGuarded(options: RenderOptions) {
  return renderWithAuth(
    <Routes>
      <Route path={paths.login} element={<span>login screen</span>} />
      <Route element={<RequireAuth skipPasswordGate />}>
        <Route path={paths.changePassword} element={<span>change password screen</span>} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route path={paths.myTickets} element={<span>protected content</span>} />
      </Route>
    </Routes>,
    options,
  );
}
