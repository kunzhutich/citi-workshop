import { useMemo } from 'react';
import { useLocation, type Location } from 'react-router-dom';

import type { CurrentUser } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { activeNavItem, navItemsFor, type NavItem } from '../../layout/navigation';
import { paths } from '../../routes';

/**
 * Where the ticket detail page's back link goes, and what it is called.
 *
 * Two faults shared one cause. The detail page's back link was a literal
 * `<Button to={paths.allTickets}>All tickets</Button>`, so it always said "All
 * tickets" whatever screen you had come from, and it always went to a bare
 * `/tickets` — throwing away the query string that *is* the list's state
 * (`useIncidentFilters.ts`). Filtering All Tickets, opening a ticket and
 * pressing the app's back link therefore lost the filters, which read as a
 * fault in the filters and was a fault in the link.
 *
 * The browser's own back button was never affected: filters are written with
 * `replace`, so the entry the list was on already carries them and going back
 * restores them. Only the in-app link discarded them.
 *
 * **How the origin travels.** The link that opened the ticket puts it in
 * React Router's navigation state — `useTicketLinkState()` below, spread onto
 * every link that leads to a ticket. Navigation state lives in the history
 * entry, so it survives a reload and comes back correctly on forward/back; it
 * is simply absent when a ticket is reached by a pasted URL, which is what the
 * fallback is for.
 *
 * The alternative was to guess from browser history, which React Router does
 * not expose, or to remember the last list screen in a module variable, which
 * is a second copy of the URL and is wrong the moment two tabs are open.
 */

export interface BackTarget {
  /** What the link says, as the user's own navigation names that screen. */
  label: string;
  /** Where it goes, path and query string together. */
  to: string;
}

/**
 * Where the link goes when nothing said where you came from.
 *
 * A pasted link, a bookmark, or the redirect after reporting an issue. "All
 * tickets" is a screen every role has.
 */
export const DEFAULT_BACK_TARGET: BackTarget = {
  label: 'All tickets',
  to: paths.allTickets,
};

/**
 * Screens that link to a ticket but are not in anybody's navigation list.
 *
 * The inbox is reached from the app bar's bell rather than the sidebar, so
 * `navItemsFor` does not know about it — and it is one of the two origins the
 * redesign brief names by hand.
 */
const EXTRA_ORIGINS: NavItem[] = [
  {
    label: 'Notifications',
    path: paths.notifications,
    // Never rendered: this list is only ever read for its labels and paths.
    icon: () => null,
  },
];

/**
 * Name the screen a location is on, as *this* user's navigation names it.
 *
 * Deliberately not a table of its own. An admin's sidebar calls `/tickets`
 * "Tickets" and an employee's calls it "All tickets"; a back link that used a
 * third wording would be a third name for one screen. `activeNavItem` supplies
 * the longest-prefix rule, so `/tickets/mine` resolves to "My tickets" rather
 * than to "All tickets" at `/tickets`.
 */
export function backTargetFor(location: Location, user: CurrentUser | null): BackTarget {
  if (!user) {
    return DEFAULT_BACK_TARGET;
  }

  const item = activeNavItem(location.pathname, [...navItemsFor(user), ...EXTRA_ORIGINS]);
  if (!item) {
    return DEFAULT_BACK_TARGET;
  }

  return { label: item.label, to: `${location.pathname}${location.search}` };
}

/**
 * The navigation state a link to a ticket should carry.
 *
 * Spread onto the link — `state={ticketLinkState}` — so the ticket page can
 * name where the reader came from and take them back to exactly that list,
 * filters and page number included.
 */
export function useTicketLinkState(): { from: BackTarget } {
  const location = useLocation();
  const { user } = useAuth();

  return useMemo(() => ({ from: backTargetFor(location, user) }), [location, user]);
}

/** The back target the current history entry carries, or the fallback. */
export function useBackTarget(): BackTarget {
  const { state } = useLocation();
  return readBackTarget(state) ?? DEFAULT_BACK_TARGET;
}

/**
 * Read a back target out of navigation state, or refuse it.
 *
 * History state is not ours in the way a prop is: it survives a reload, it can
 * be edited from the console, and an older bundle may have written a different
 * shape into the entry the user is about to go back to. So it is validated
 * rather than trusted, and `to` in particular has to be an in-app absolute
 * path — a protocol-relative `//elsewhere.example` is a link off the site, and
 * this link is not allowed to be one.
 */
export function readBackTarget(state: unknown): BackTarget | null {
  if (typeof state !== 'object' || state === null) {
    return null;
  }

  const { from } = state as { from?: unknown };
  if (typeof from !== 'object' || from === null) {
    return null;
  }

  const { label, to } = from as { label?: unknown; to?: unknown };
  if (typeof label !== 'string' || typeof to !== 'string') {
    return null;
  }
  if (label === '' || !to.startsWith('/') || to.startsWith('//')) {
    return null;
  }

  return { label, to };
}
