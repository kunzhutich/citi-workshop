import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CurrentUser } from '../api/types';
import { paths } from '../routes';
import { makeAdmin, makeEngineer, makeUser } from '../test/factories';
import { renderWithAuth } from '../test/renderWithProviders';
import { setViewportWidth } from '../test/viewport';
import { MOBILE_MAX_WIDTH } from '../hooks/useBreakpoint';
import { AppShell } from './AppShell';

/**
 * The shell's one real decision: which navigation surface to render at which
 * width. The switch happens at Material UI's `md` breakpoint, 900 px, so 899
 * is a phone and 900 is a desktop.
 *
 * Widths tested: 375 (phone), 768 (tablet, still mobile), 1440 (desktop).
 */

beforeEach(() => {
  setViewportWidth(1440);
});

describe('desktop layout', () => {
  it('shows a permanent sidebar and no bottom bar', () => {
    renderShell(makeUser());

    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My tickets' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open navigation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'All tickets' })).not.toBeInTheDocument();
  });

  it('renders the routed page inside the frame', () => {
    renderShell(makeUser());

    expect(screen.getByText('home content')).toBeInTheDocument();
  });

  it('keeps the account in the top bar and out of the sidebar', () => {
    renderShell(makeUser());

    expect(screen.getByRole('button', { name: /Account menu/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Account' })).not.toBeInTheDocument();
  });

  it('still uses the desktop layout at exactly the breakpoint', () => {
    setViewportWidth(MOBILE_MAX_WIDTH + 1);

    renderShell(makeUser());

    expect(screen.queryByRole('button', { name: 'Open navigation' })).not.toBeInTheDocument();
  });
});

describe('mobile layout', () => {
  it('shows a bottom bar and hides the sidebar at phone width', () => {
    setViewportWidth(375);

    renderShell(makeUser());

    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'My tickets' })).toBeInTheDocument();
  });

  it('treats a tablet at 768 px as mobile', () => {
    setViewportWidth(768);

    renderShell(makeUser());

    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeInTheDocument();
  });

  it('switches to mobile one pixel below the breakpoint', () => {
    setViewportWidth(MOBILE_MAX_WIDTH);

    renderShell(makeUser());

    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeInTheDocument();
  });

  it('gives the reachable corner to the drawer button, not the avatar', () => {
    // Right-handed reach beats convention here: on a phone the trailing
    // control is the one people open most, and the account moves into the
    // drawer rather than competing for the same corner.
    setViewportWidth(375);

    renderShell(makeUser());

    expect(screen.queryByRole('button', { name: /Account menu/ })).not.toBeInTheDocument();
    const toolbarButton = screen.getByRole('button', { name: 'Open navigation' });
    const title = screen.getByRole('link', { name: 'ACME Facilities' });
    expect(follows(title, toolbarButton)).toBe(true);
  });

  it('offers employees a floating report button', () => {
    setViewportWidth(375);

    renderShell(makeUser());

    expect(screen.getByRole('link', { name: 'Report an issue' })).toBeInTheDocument();
  });

  it('keeps the items that do not fit the bottom bar reachable in the drawer', async () => {
    // An admin has six navigation items and the bar holds four. Without the
    // menu button, Categories and Users would be unreachable on a phone.
    setViewportWidth(375);
    renderShell(makeAdmin());

    expect(screen.queryByRole('link', { name: 'Categories' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));

    expect(screen.getByRole('link', { name: 'Categories' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument();
  });
});

describe('navigation content', () => {
  it('shows a lead engineer the team page', () => {
    renderShell(makeEngineer('LEAD'));

    expect(screen.getByRole('link', { name: 'Team' })).toBeInTheDocument();
  });

  it('does not show a junior engineer the team page', () => {
    renderShell(makeEngineer('JUNIOR'));

    expect(screen.queryByRole('link', { name: 'Team' })).not.toBeInTheDocument();
  });

  it('marks the current page as selected', () => {
    renderShell(makeUser(), paths.myTickets);

    expect(screen.getByRole('link', { name: 'My tickets' })).toHaveClass('Mui-selected');
    expect(screen.getByRole('link', { name: 'All tickets' })).not.toHaveClass('Mui-selected');
  });
});

describe('the mobile drawer', () => {
  it('puts the account below the work navigation', async () => {
    setViewportWidth(375);
    renderShell(makeEngineer('LEAD', { full_name: 'Sam Rivera' }));

    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));

    const work = screen.getByRole('navigation', { name: 'Main' });
    const account = screen.getByRole('region', { name: 'Account' });
    expect(follows(work, account)).toBe(true);
  });

  it('separates the two halves with a divider', async () => {
    setViewportWidth(375);
    renderShell(makeUser());

    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));

    const work = screen.getByRole('navigation', { name: 'Main' });
    const account = screen.getByRole('region', { name: 'Account' });
    const between = screen
      .getAllByRole('separator')
      .filter((rule) => follows(work, rule) && follows(rule, account));
    expect(between).toHaveLength(1);
  });

  it('names the signed-in user, since the top bar no longer does', async () => {
    setViewportWidth(375);
    renderShell(makeEngineer('SENIOR', { full_name: 'Sam Rivera' }));

    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));

    const account = within(screen.getByRole('region', { name: 'Account' }));
    expect(account.getByText('Sam Rivera')).toBeInTheDocument();
    expect(account.getByText('Senior engineer')).toBeInTheDocument();
  });

  it('carries the account actions', async () => {
    setViewportWidth(375);
    renderShell(makeUser());

    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));

    const account = within(screen.getByRole('region', { name: 'Account' }));
    expect(account.getByRole('button', { name: 'Change password' })).toBeInTheDocument();
    expect(account.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });

  it('signs the user out from the drawer', async () => {
    setViewportWidth(375);
    const signOut = vi.fn().mockResolvedValue(undefined);
    renderShell(makeUser(), paths.home, signOut);

    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(signOut).toHaveBeenCalledOnce();
  });
});

describe('account menu', () => {
  it('signs the user out', async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    renderShell(makeUser(), paths.home, signOut);

    await userEvent.click(screen.getByRole('button', { name: /Account menu for Jordan Lee/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Log out' }));

    expect(signOut).toHaveBeenCalledOnce();
  });

  it('names the signed-in user and their role', async () => {
    renderShell(makeEngineer('SENIOR', { full_name: 'Sam Rivera' }));

    await userEvent.click(screen.getByRole('button', { name: /Account menu for Sam Rivera/ }));

    expect(screen.getByText('Sam Rivera')).toBeInTheDocument();
    expect(screen.getByText('Senior engineer')).toBeInTheDocument();
  });
});

/** Render the shell around a couple of routed pages. */
function renderShell(user: CurrentUser, route: string = paths.home, signOut = vi.fn()) {
  return renderWithAuth(
    <Routes>
      <Route element={<AppShell />}>
        <Route path={paths.home} element={<span>home content</span>} />
        <Route path={paths.myTickets} element={<span>my tickets content</span>} />
        <Route path={paths.categories} element={<span>categories content</span>} />
      </Route>
    </Routes>,
    { user, route, signOut },
  );
}

/**
 * Whether `later` appears after `earlier` in document order, as siblings.
 *
 * A descendant also reports `DOCUMENT_POSITION_FOLLOWING`, which would make
 * the divider *inside* the work navigation look like a divider *after* it —
 * so containment is excluded explicitly.
 */
function follows(earlier: Element, later: Element): boolean {
  const position = earlier.compareDocumentPosition(later);
  return Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING) && !earlier.contains(later);
}
