import { describe, expect, it } from 'vitest';

import { makeAdmin, makeEngineer, makeUser } from '../test/factories';
import { paths } from '../routes';
import { activeNavPath, navItemsFor, reportNavItem } from './navigation';

/**
 * Who sees which navigation items — the table from BUILD-PLAN.md section 10,
 * asserted rather than described.
 */

describe('navItemsFor', () => {
  it('gives an employee their tickets and everyone elses', () => {
    expect(labels(makeUser())).toEqual(['Home', 'My tickets', 'All tickets']);
  });

  it('gives a junior engineer no way to pick up or assign work', () => {
    // Juniors are assigned to by their lead or an admin, so neither the
    // Unassigned queue nor the Team page would do anything for them.
    expect(labels(makeEngineer('JUNIOR'))).toEqual(['Home', 'My queue', 'All tickets']);
  });

  it('gives a senior engineer the unassigned queue', () => {
    expect(labels(makeEngineer('SENIOR'))).toEqual([
      'Home',
      'My queue',
      'Unassigned',
      'All tickets',
    ]);
  });

  it('gives a lead the team page as well', () => {
    expect(labels(makeEngineer('LEAD'))).toEqual([
      'Home',
      'My queue',
      'Unassigned',
      'All tickets',
      'Team',
    ]);
  });

  it('gives an admin the four things only they maintain', () => {
    expect(labels(makeAdmin())).toEqual([
      'Dashboard',
      'Tickets',
      'Engineers',
      'Facilities',
      'Categories',
      'Users',
    ]);
  });

  it('offers every role the report button', () => {
    expect(reportNavItem.path).toBe(paths.report);
  });
});

describe('activeNavPath', () => {
  const items = navItemsFor(makeUser());

  it('matches the home path only exactly', () => {
    expect(activeNavPath(paths.home, items)).toBe(paths.home);
    expect(activeNavPath(paths.allTickets, items)).toBe(paths.allTickets);
  });

  it('prefers the longest matching prefix', () => {
    // `/tickets/mine` starts with `/tickets`, so the shorter item would win a
    // first-match search and highlight the wrong entry.
    expect(activeNavPath(paths.myTickets, items)).toBe(paths.myTickets);
  });

  it('highlights the parent item for a nested route', () => {
    expect(activeNavPath('/tickets/INC-000123', items)).toBe(paths.allTickets);
  });

  it('highlights nothing on a route outside the navigation', () => {
    expect(activeNavPath('/somewhere-else', items)).toBe(false);
  });
});

/** The labels of a user's navigation, in order. */
function labels(user: Parameters<typeof navItemsFor>[0]): string[] {
  return navItemsFor(user).map((item) => item.label);
}
