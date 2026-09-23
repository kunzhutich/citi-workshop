import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MyReport, PersonalCounts } from '../../api/reports';
import type { Page, IncidentListItem } from '../../api/types';
import { makeIncidentListItem, makeTransition, makeUser } from '../../test/factories';
import { renderWithAuth } from '../../test/renderWithProviders';

/**
 * The rules the employee's home screen introduces.
 *
 * Three of them, and each is a thing that would fail quietly rather than
 * loudly if it broke:
 *
 * 1. **"Needs your attention" is hidden when it is empty.** A heading that
 *    demands attention in order to report that none is needed is worse than no
 *    heading, and an empty one would push the recent tickets below the fold.
 * 2. **Its buttons come from `allowed-transitions`.** Not from
 *    `status === 'RESOLVED'`. The screen must draw what the API offers, so
 *    that a reporter outside the reopen window is not shown a button the API
 *    will refuse.
 * 3. **The counts are labelled as current state**, never as a period. That is
 *    decision D9 reaching the UI: `/reports/me` takes no date range, so
 *    nothing drawn from it may imply one.
 */

vi.mock('../../api/reports', () => ({ fetchMyReport: vi.fn() }));
vi.mock('../../api/incidents', () => ({
  listIncidents: vi.fn(),
  fetchAllowedTransitions: vi.fn(),
  performTransition: vi.fn(),
}));

const { fetchMyReport } = await import('../../api/reports');
const { listIncidents, fetchAllowedTransitions } = await import('../../api/incidents');
const { EmployeeHomePage } = await import('./EmployeeHomePage');

const fetchMyReportMock = vi.mocked(fetchMyReport);
const listIncidentsMock = vi.mocked(listIncidents);
const fetchAllowedTransitionsMock = vi.mocked(fetchAllowedTransitions);

function counts(overrides: Partial<PersonalCounts> = {}): PersonalCounts {
  return {
    total: 0,
    active: 0,
    open: 0,
    in_progress: 0,
    blocked: 0,
    resolved: 0,
    closed: 0,
    escalated: 0,
    ...overrides,
  };
}

function myReport(reported: Partial<PersonalCounts>): MyReport {
  return {
    scope: { as_of: '2026-09-23T09:00:00Z', building_id: null },
    role: 'EMPLOYEE',
    reported: counts(reported),
    assigned: null,
  };
}

function page(items: IncidentListItem[]): Page<IncidentListItem> {
  return { items, total: items.length, page: 1, page_size: 5 };
}

/**
 * Answer the two list requests separately.
 *
 * The screen asks twice — once for resolved tickets and once for the most
 * recent — and a single canned answer would make the two sections identical,
 * which would hide exactly the bug these tests are for.
 */
function respondToLists(resolved: IncidentListItem[], recent: IncidentListItem[]) {
  listIncidentsMock.mockImplementation((query) =>
    Promise.resolve(page(query.status?.includes('RESOLVED') ? resolved : recent)),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMyReportMock.mockResolvedValue(myReport({}));
  respondToLists([], []);
  fetchAllowedTransitionsMock.mockResolvedValue([]);
});

describe('needs your attention', () => {
  it('is hidden entirely when no ticket is waiting on the reporter', async () => {
    respondToLists([], [makeIncidentListItem({ status: 'OPEN' })]);

    renderWithAuth(<EmployeeHomePage user={makeUser()} />, { user: makeUser() });

    // Waited for, not asserted immediately: an absence that is only true
    // because nothing has loaded yet would pass without proving anything.
    await screen.findByText('Your recent tickets');
    expect(screen.queryByText('Needs your attention')).not.toBeInTheDocument();
  });

  it('appears when a ticket the reporter raised has been resolved', async () => {
    respondToLists(
      [makeIncidentListItem({ status: 'RESOLVED', reference: 'INC-000295' })],
      [makeIncidentListItem({ status: 'RESOLVED', reference: 'INC-000295' })],
    );

    renderWithAuth(<EmployeeHomePage user={makeUser()} />, { user: makeUser() });

    expect(await screen.findByText('Needs your attention')).toBeInTheDocument();
  });

  it('draws the buttons the API offers, and only those', async () => {
    respondToLists([makeIncidentListItem({ status: 'RESOLVED' })], []);
    fetchAllowedTransitionsMock.mockResolvedValue([
      makeTransition('CLOSED', 'Confirm fixed'),
      makeTransition('IN_PROGRESS', 'Still broken', { required_fields: ['reason'] }),
    ]);

    renderWithAuth(<EmployeeHomePage user={makeUser()} />, { user: makeUser() });

    expect(await screen.findByRole('button', { name: 'Confirm fixed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Still broken' })).toBeInTheDocument();
  });

  it('draws no buttons when the API offers none, whatever the status says', async () => {
    // The case that separates "renders the API's answer" from "renders a
    // rule": a RESOLVED ticket whose reporter may no longer act on it.
    respondToLists([makeIncidentListItem({ status: 'RESOLVED' })], []);
    fetchAllowedTransitionsMock.mockResolvedValue([]);

    renderWithAuth(<EmployeeHomePage user={makeUser()} />, { user: makeUser() });

    await screen.findByText('Needs your attention');
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Confirm fixed' })).not.toBeInTheDocument();
    });
  });
});

describe('the four count tiles', () => {
  it('shows the counts from /reports/me, one tile each', async () => {
    fetchMyReportMock.mockResolvedValue(
      myReport({ open: 4, in_progress: 0, blocked: 1, resolved: 2 }),
    );

    renderWithAuth(<EmployeeHomePage user={makeUser()} />, { user: makeUser() });

    for (const [label, value] of [
      ['Open', '4'],
      ['In progress', '0'],
      ['Blocked', '1'],
      ['Awaiting your confirmation', '2'],
    ]) {
      const tile = (await screen.findByText(label)).closest('.MuiCard-root');
      expect(tile).toHaveTextContent(value);
    }
  });

  it('links each tile to the same tickets it counted', async () => {
    fetchMyReportMock.mockResolvedValue(myReport({ blocked: 1 }));

    renderWithAuth(<EmployeeHomePage user={makeUser()} />, { user: makeUser() });

    const tile = (await screen.findByText('Blocked')).closest('a');
    expect(tile).toHaveAttribute('href', '/tickets/mine?status=BLOCKED');
  });

  it('says the counts are current state, and never names a period', async () => {
    // Decision D9 arriving in the UI. `/reports/me` is not windowed, so a
    // caption implying a period here would be the defect D9 fixed, put back.
    renderWithAuth(<EmployeeHomePage user={makeUser()} />, { user: makeUser() });

    expect(
      await screen.findByText(/Your tickets as they stand now, however long ago/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/last 30 days/i)).not.toBeInTheDocument();
  });
});

describe('the greeting and the report button', () => {
  it('greets the reader by their first name', async () => {
    renderWithAuth(<EmployeeHomePage user={makeUser({ full_name: 'Raj Patel' })} />, {
      user: makeUser(),
    });

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/, Raj$/);
  });

  it('leads with Report an issue', async () => {
    renderWithAuth(<EmployeeHomePage user={makeUser()} />, { user: makeUser() });

    const button = screen.getAllByRole('link', { name: /Report an issue/ })[0];
    expect(button).toHaveAttribute('href', '/report');
  });
});
