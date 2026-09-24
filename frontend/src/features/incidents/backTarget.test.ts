import { describe, expect, it } from 'vitest';
import type { Location } from 'react-router-dom';

import { makeAdmin, makeEngineer, makeUser } from '../../test/factories';
import { paths } from '../../routes';
import { DEFAULT_BACK_TARGET, backTargetFor, readBackTarget } from './backTarget';

/**
 * Where the ticket page's back link goes, and what it is called.
 *
 * Two of the redesign brief's bugs — the link always saying "All tickets", and
 * a filtered list losing its filters on the way back — were the same hardcoded
 * `<Button to="/tickets">`. These are the assertions that keep it honest.
 */

/** A `Location` with only the fields `backTargetFor` reads. */
function at(pathname: string, search = ''): Location {
  return { pathname, search, hash: '', state: null, key: 'test' };
}

describe('backTargetFor', () => {
  it('keeps the query string, which is where a list keeps its filters', () => {
    expect(backTargetFor(at(paths.allTickets, '?status=BLOCKED&page=2'), makeUser())).toEqual({
      label: 'All tickets',
      to: '/tickets?status=BLOCKED&page=2',
    });
  });

  it('prefers the longest matching screen, so My tickets is not All tickets', () => {
    expect(backTargetFor(at(paths.myTickets), makeUser()).label).toBe('My tickets');
  });

  it('names the inbox, which is reached from the bell rather than the sidebar', () => {
    expect(backTargetFor(at(paths.notifications), makeUser())).toEqual({
      label: 'Notifications',
      to: '/notifications',
    });
  });

  it('names each screen the way that user own navigation names it', () => {
    // The same URL, two roles, two labels. An admin sidebar says "Tickets"
    // where an employee's says "All tickets", and the back link agrees with
    // whichever one the reader has been looking at all day.
    expect(backTargetFor(at(paths.allTickets), makeAdmin()).label).toBe('Tickets');
    expect(backTargetFor(at(paths.allTickets), makeUser()).label).toBe('All tickets');

    expect(backTargetFor(at(paths.myQueue), makeEngineer('SENIOR')).label).toBe('My queue');
    expect(backTargetFor(at(paths.unassigned), makeEngineer('SENIOR')).label).toBe('Unassigned');
    expect(backTargetFor(at(paths.team), makeEngineer('LEAD')).label).toBe('Team');

    expect(backTargetFor(at(paths.home), makeAdmin()).label).toBe('Dashboard');
    expect(backTargetFor(at(paths.home), makeUser()).label).toBe('Home');
  });

  it('falls back when the screen is not one this user has', () => {
    // A senior engineer has no Team page, so a link from one is not a place
    // to offer to send them back to.
    expect(backTargetFor(at(paths.team), makeEngineer('SENIOR'))).toEqual(DEFAULT_BACK_TARGET);
    expect(backTargetFor(at(paths.allTickets), null)).toEqual(DEFAULT_BACK_TARGET);
  });
});

describe('readBackTarget', () => {
  it('reads a target a link wrote', () => {
    expect(readBackTarget({ from: { label: 'My tickets', to: '/tickets/mine?page=3' } })).toEqual({
      label: 'My tickets',
      to: '/tickets/mine?page=3',
    });
  });

  it.each([
    ['nothing at all', null],
    ['state from some other feature', { scrollTo: 'top' }],
    ['a target that is not an object', { from: 'the list' }],
    ['a target with no label', { from: { to: '/tickets' } }],
    ['a target with an empty label', { from: { label: '', to: '/tickets' } }],
    ['a target with no destination', { from: { label: 'All tickets' } }],
  ])('refuses %s', (_case, state) => {
    expect(readBackTarget(state)).toBeNull();
  });

  it.each([
    ['an off-site URL', 'https://example.test/tickets'],
    ['a protocol-relative URL', '//example.test/tickets'],
    ['a relative path', 'tickets'],
  ])('refuses %s, because a back link stays in the application', (_case, to) => {
    // History state survives a reload and can be edited from the console, so
    // it is checked rather than trusted.
    expect(readBackTarget({ from: { label: 'Elsewhere', to } })).toBeNull();
  });
});
