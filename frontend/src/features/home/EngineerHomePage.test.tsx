import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MyReport, PersonalCounts } from '../../api/reports';
import type { EngineerLevel, IncidentListItem, Page } from '../../api/types';
import { makeEngineer, makeIncidentListItem } from '../../test/factories';
import { renderWithAuth } from '../../test/renderWithProviders';

/**
 * The rules the engineer's home screen introduces.
 *
 * The load-bearing one is the **level split**. A JUNIOR may never pick a
 * ticket up — `services/assignment.py` refuses them — so showing them an
 * unassigned queue with Pick up buttons would be an invitation to a 403. The
 * build plan asks for a sentence instead, and an *empty queue* would not do:
 * it reads as "there is nothing to pick up" rather than "this is not how you
 * get work".
 *
 * The second is that the fourth tile does not claim to count a week. See
 * decision D14: `/reports/me` is current state, `/reports/engineer-workload`
 * is admin-only, and no endpoint an engineer may call answers "resolved this
 * week". The tile counts what can be answered and says which that is.
 */

vi.mock('../../api/reports', () => ({ fetchMyReport: vi.fn() }));
vi.mock('../../api/incidents', () => ({
  listIncidents: vi.fn(),
  pickUpIncident: vi.fn(),
}));

const { fetchMyReport } = await import('../../api/reports');
const { listIncidents } = await import('../../api/incidents');
const { EngineerHomePage } = await import('./EngineerHomePage');

const fetchMyReportMock = vi.mocked(fetchMyReport);
const listIncidentsMock = vi.mocked(listIncidents);

const JUNIOR_MESSAGE = 'New tickets are assigned to you by your lead or admin.';

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

function myReport(assigned: Partial<PersonalCounts>): MyReport {
  return {
    scope: { as_of: '2026-09-23T09:00:00Z', building_id: null },
    role: 'ENGINEER',
    reported: counts(),
    assigned: counts(assigned),
  };
}

function page(items: IncidentListItem[]): Page<IncidentListItem> {
  return { items, total: items.length, page: 1, page_size: 6 };
}

/** Answer the assigned-tickets request and the unassigned one separately. */
function respondToLists(mine: IncidentListItem[], unassigned: IncidentListItem[]) {
  listIncidentsMock.mockImplementation((query) =>
    Promise.resolve(page(query.mine === 'assigned' ? mine : unassigned)),
  );
}

function renderFor(level: EngineerLevel) {
  const user = makeEngineer(level);
  return renderWithAuth(<EngineerHomePage user={user} />, { user });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMyReportMock.mockResolvedValue(myReport({}));
  respondToLists([], []);
});

describe('what each engineer level is offered', () => {
  it.each(['SENIOR', 'LEAD'] as EngineerLevel[])(
    'offers %s engineers the unassigned queue with Pick up',
    async (level) => {
      respondToLists([], [makeIncidentListItem({ reference: 'INC-000900' })]);

      renderFor(level);

      expect(await screen.findByText('Unassigned in your specialties')).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: 'Pick up' })).toBeInTheDocument();
      expect(screen.queryByText(JUNIOR_MESSAGE)).not.toBeInTheDocument();
    },
  );

  it('gives a JUNIOR the sentence instead of the queue', async () => {
    // Deliberately with a ticket available to pick up: a junior must not see
    // it even when there is one, so the absence is about the level and not
    // about an empty result.
    respondToLists([], [makeIncidentListItem({ reference: 'INC-000900' })]);

    renderFor('JUNIOR');

    expect(await screen.findByText(JUNIOR_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText('Unassigned in your specialties')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pick up' })).not.toBeInTheDocument();
  });

  it('never even asks for the unassigned queue as a JUNIOR', async () => {
    renderFor('JUNIOR');

    await screen.findByText(JUNIOR_MESSAGE);
    await waitFor(() => expect(listIncidentsMock).toHaveBeenCalled());
    const asked = listIncidentsMock.mock.calls.map(([query]) => query);
    expect(asked.some((query) => query.assignee_id === 'unassigned')).toBe(false);
  });
});

describe('the four count tiles', () => {
  it('counts this engineer’s own work, from /reports/me', async () => {
    fetchMyReportMock.mockResolvedValue(
      myReport({ open: 2, in_progress: 3, blocked: 4, resolved: 1 }),
    );

    renderFor('SENIOR');

    for (const [label, value] of [
      ['Assigned, not started', '2'],
      ['In progress', '3'],
      ['Blocked', '4'],
      ['Resolved, awaiting confirmation', '1'],
    ]) {
      const tile = (await screen.findByText(label)).closest('.MuiCard-root');
      expect(tile).toHaveTextContent(value);
    }
  });

  it('does not claim to count a week, because no endpoint can tell it one', async () => {
    // BUILD-PLAN names this tile "Resolved this week". D14 explains why the
    // label is different: rather than a number that would quietly mean
    // something else, the tile reports the current-state count it really has.
    renderFor('LEAD');

    expect(await screen.findByText('Resolved, awaiting confirmation')).toBeInTheDocument();
    expect(screen.queryByText(/this week/i)).not.toBeInTheDocument();
  });
});

describe('my active tickets', () => {
  it('asks for the most urgent first, then orders ties by age', async () => {
    const older = makeIncidentListItem({
      id: 'older',
      reference: 'INC-000100',
      priority: 'HIGH',
      created_at: '2026-01-01T09:00:00Z',
    });
    const newer = makeIncidentListItem({
      id: 'newer',
      reference: 'INC-000200',
      priority: 'HIGH',
      created_at: '2026-06-01T09:00:00Z',
    });
    const critical = makeIncidentListItem({
      id: 'critical',
      reference: 'INC-000300',
      priority: 'CRITICAL',
      created_at: '2026-09-01T09:00:00Z',
    });

    // Served in the wrong order on purpose: the screen has to produce the
    // right one rather than pass the server's through.
    respondToLists([newer, older, critical], []);

    renderFor('SENIOR');

    const references = await screen.findAllByText(/^INC-\d+$/);
    expect(references.map((node) => node.textContent)).toEqual([
      'INC-000300',
      'INC-000100',
      'INC-000200',
    ]);
    expect(listIncidentsMock).toHaveBeenCalledWith(
      expect.objectContaining({ mine: 'assigned', sort: '-priority' }),
    );
  });
});
