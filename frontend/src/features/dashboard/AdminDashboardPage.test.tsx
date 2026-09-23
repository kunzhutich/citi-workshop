import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  BlockedEscalatedReport,
  CategoriesReport,
  EngineerWorkloadReport,
  LocationsReport,
  ResponseTimesReport,
  SummaryReport,
} from '../../api/reports';
import type { FacilityTree, Page, IncidentListItem } from '../../api/types';
import { makeAdmin } from '../../test/factories';
import { renderWithAuth } from '../../test/renderWithProviders';

/**
 * The one rule this screen exists to keep: **a number is labelled with the
 * scope it was actually computed under.**
 *
 * Decision D9 split the eight reports in two — six cover a period, two
 * describe the present — precisely because a dashboard was going to put them
 * side by side under one date filter. The failure it was raised against is a
 * tile reading "Blocked · 21" under a "last 30 days" heading when the 21 is
 * every blocked ticket there has ever been.
 *
 * These tests hold that line from the UI side, and they use *different* values
 * for the period and the live figures so that a screen which quietly drew one
 * where the other belongs fails rather than passes by coincidence.
 */

vi.mock('../../api/reports', () => ({
  fetchSummary: vi.fn(),
  fetchCategories: vi.fn(),
  fetchLocations: vi.fn(),
  fetchResponseTimes: vi.fn(),
  fetchEngineerWorkload: vi.fn(),
  fetchBlockedEscalated: vi.fn(),
  fetchCommunication: vi.fn(),
  fetchMyReport: vi.fn(),
}));
vi.mock('../../api/incidents', () => ({ listIncidents: vi.fn(), assignIncident: vi.fn() }));
vi.mock('../../api/facilities', () => ({ fetchFacilityTree: vi.fn() }));

const reportsApi = await import('../../api/reports');
const { listIncidents } = await import('../../api/incidents');
const { fetchFacilityTree } = await import('../../api/facilities');
const { AdminDashboardPage } = await import('./AdminDashboardPage');

const WINDOW = {
  from: '2026-08-24T00:00:00Z',
  to: '2026-09-23T00:00:00Z',
  building_id: null,
};

/** The period figures. Every one deliberately unlike its live counterpart. */
const SUMMARY: SummaryReport = {
  window: WINDOW,
  total: 120,
  active_total: 45,
  unassigned_total: 13,
  blocked_total: 11,
  escalated_total: 12,
  by_status: [
    { status: 'OPEN', count: 20 },
    { status: 'IN_PROGRESS', count: 14 },
    { status: 'BLOCKED', count: 11 },
    { status: 'RESOLVED', count: 14 },
    { status: 'CLOSED', count: 61 },
  ],
  by_priority: [
    { priority: 'LOW', count: 25 },
    { priority: 'MEDIUM', count: 45 },
    { priority: 'HIGH', count: 39 },
    { priority: 'CRITICAL', count: 11 },
  ],
  by_assignee: [],
  per_day: [{ day: '2026-09-23', created: 3, closed: 2 }],
};

/** The live figures. Blocked and escalated are both larger than the period's. */
const LIVE: BlockedEscalatedReport = {
  scope: { as_of: '2026-09-23T09:00:00Z', building_id: null },
  blocked_total: 21,
  escalated_total: 16,
  blocked: [
    {
      blocked_reason_type: 'WAITING_ON_PARTS',
      count: 7,
      average_age_hours: 479.95,
      max_age_hours: 777.35,
    },
  ],
  escalated: [
    {
      incident_id: 'esc-1',
      reference: 'INC-000275',
      title: 'Other hardware overheats under load',
      status: 'OPEN',
      priority: 'HIGH',
      escalation_reason: 'Third time this month at the same desk.',
      escalated_at: '2026-09-22T03:00:00Z',
      age_hours: 26.6,
    },
  ],
};

const CATEGORIES: CategoriesReport = {
  window: WINDOW,
  total: 120,
  groups: [
    {
      group_id: 'g-hardware',
      group_name: 'Hardware',
      count: 38,
      subcategories: [{ category_id: 'c-laptop', category_name: 'Laptop/Desktop', count: 16 }],
    },
  ],
};

const LOCATIONS: LocationsReport = {
  window: WINDOW,
  total: 120,
  buildings: [
    { building_id: 'b-sfo', building_name: 'San Francisco HQ', building_code: 'SFO-1', count: 62 },
  ],
  floors: [],
  seats: [],
};

const RESPONSE_TIMES: ResponseTimesReport = {
  window: WINDOW,
  overall: {
    priority: null,
    total: 120,
    assigned_count: 89,
    acknowledged_count: 82,
    resolved_count: 57,
    median_assign_hours: 4.28,
    median_acknowledge_hours: 7.76,
    median_resolve_hours: 35.39,
  },
  by_priority: [],
};

const WORKLOAD: EngineerWorkloadReport = {
  window: WINDOW,
  engineers: [
    {
      user_id: 'eng-1',
      full_name: 'Grace Lin',
      level: 'LEAD',
      availability: 'AVAILABLE',
      max_active_tickets: 16,
      open_count: 3,
      in_progress_count: 6,
      blocked_count: 5,
      active_count: 14,
      capacity_used_pct: 87.5,
      resolved_in_period: 13,
    },
  ],
};

const FACILITIES: FacilityTree = {
  buildings: [
    {
      id: 'b-sfo',
      name: 'San Francisco HQ',
      code: 'SFO-1',
      address: null,
      is_active: true,
      floors: [],
    },
  ],
};

function emptyPage(): Page<IncidentListItem> {
  return { items: [], total: 0, page: 1, page_size: 50 };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reportsApi.fetchSummary).mockResolvedValue(SUMMARY);
  vi.mocked(reportsApi.fetchCategories).mockResolvedValue(CATEGORIES);
  vi.mocked(reportsApi.fetchLocations).mockResolvedValue(LOCATIONS);
  vi.mocked(reportsApi.fetchResponseTimes).mockResolvedValue(RESPONSE_TIMES);
  vi.mocked(reportsApi.fetchEngineerWorkload).mockResolvedValue(WORKLOAD);
  vi.mocked(reportsApi.fetchBlockedEscalated).mockResolvedValue(LIVE);
  vi.mocked(fetchFacilityTree).mockResolvedValue(FACILITIES);
  vi.mocked(listIncidents).mockResolvedValue(emptyPage());
});

function render(route = '/') {
  return renderWithAuth(<AdminDashboardPage />, { user: makeAdmin(), route });
}

/**
 * The card a tile belongs to, found by its **caption**.
 *
 * Not by its label: "Blocked" is a tile, a bar on the status chart and a
 * column in the workload table, and a query that matched all three would be
 * ambiguous in exactly the place this file is trying to be precise. A caption
 * is unique to one tile by construction — it is the line that says what the
 * number is scoped to.
 */
async function tileByCaption(caption: string | RegExp) {
  const node = await screen.findByText(caption);
  const card = node.closest('.MuiCard-root');
  if (!card) {
    throw new Error(`"${String(caption)}" is not inside a card`);
  }
  return card as HTMLElement;
}

describe('period reports are not asked for the present, and vice versa', () => {
  it('sends from and to to the six period reports', async () => {
    render();

    await screen.findByText('Reported in this period');
    for (const request of [
      reportsApi.fetchSummary,
      reportsApi.fetchCategories,
      reportsApi.fetchLocations,
      reportsApi.fetchResponseTimes,
      reportsApi.fetchEngineerWorkload,
    ]) {
      expect(vi.mocked(request)).toHaveBeenCalledWith(
        expect.objectContaining({
          from: expect.any(String) as unknown as string,
          to: expect.any(String) as unknown as string,
        }),
      );
    }
  });

  it('sends no dates at all to the current-state report', async () => {
    // The parameter type makes this a compile error too. Asserted anyway,
    // because a type is only a promise about the source and this is the
    // behaviour D9 actually cares about.
    render('/?range=7d');

    await screen.findByText('Right now');
    const [params] = vi.mocked(reportsApi.fetchBlockedEscalated).mock.calls[0];
    expect(params).not.toHaveProperty('from');
    expect(params).not.toHaveProperty('to');
    expect(Object.keys(params)).toEqual(['building_id']);
  });

  it('passes the building to both kinds, because a building is not a date', async () => {
    render('/?building_id=b-sfo');

    await screen.findByText('Right now');
    expect(vi.mocked(reportsApi.fetchSummary)).toHaveBeenCalledWith(
      expect.objectContaining({ building_id: 'b-sfo' }),
    );
    expect(vi.mocked(reportsApi.fetchBlockedEscalated)).toHaveBeenCalledWith({
      building_id: 'b-sfo',
    });
  });
});

describe('every number says which scope it was counted under', () => {
  it('heads the period section with the dates the API reported back', async () => {
    render();

    const heading = await screen.findByTestId('period-scope-heading');
    expect(heading).toHaveTextContent('Reported in this period');

    // The heading renders before the data does, saying "the selected period"
    // until it has a window to name — so the dates have to be waited for.
    // That is the point of the assertion: they come from the *response*, not
    // from the filter control, and cannot appear before the response has.
    await waitFor(() => {
      // The separator is a locale-dependent dash, so the assertion is on the
      // two dates rather than on the punctuation between them.
      expect(heading.textContent).toMatch(/Counted over .*2026.* .*2026/);
    });
  });

  it('heads the live section by saying the date range does not apply', async () => {
    render();

    const heading = await screen.findByTestId('current-scope-heading');
    expect(heading).toHaveTextContent('Right now');
    expect(heading).toHaveTextContent(/The date range above does not apply to these/);
  });

  it('draws the live blocked figure, not the period one', async () => {
    // The exact confusion D9 was raised about. 21 is live; 11 is the count of
    // tickets *reported in the period* that happen to be blocked now.
    render();

    const blocked = await tileByCaption('Stuck right now, however long ago');
    expect(blocked).toHaveTextContent('Blocked');
    expect(blocked).toHaveTextContent('21');
    expect(blocked).not.toHaveTextContent('11');
  });

  it('shows both escalated figures, in their own sections, and says why they differ', async () => {
    render();

    const periodSection = await screen.findByTestId('period-scope-heading');
    expect(periodSection.parentElement).toHaveTextContent('Reported in this period');

    // Two tiles labelled "Escalated": 12 under the period heading, 16 under
    // "Right now". Both correct; presenting either as the other is the bug.
    const escalatedTiles = await screen.findAllByText('Escalated');
    const values = escalatedTiles
      .map((node) => node.closest('.MuiCard-root')?.textContent ?? '')
      .filter((text) => /\d/.test(text));
    expect(values.some((text) => text.includes('12'))).toBe(true);
    expect(values.some((text) => text.includes('16'))).toBe(true);

    expect(
      screen.getByText(/counts every escalation raised on a ticket reported in that period/),
    ).toBeInTheDocument();
  });
});

describe('the links behind the numbers', () => {
  it('carries the period onto a period tile’s link', async () => {
    render();

    const link = (await tileByCaption('Of those, nobody has started')).querySelector('a');
    const href = link?.getAttribute('href') ?? '';
    expect(href).toContain('status=OPEN');
    expect(href).toContain('created_from=');
    expect(href).toContain('created_to=');
  });

  it('puts no dates on a current-state tile’s link', async () => {
    // A live number opened through a windowed list would show fewer tickets
    // than the tile claimed — D9's failure, one layer up from the API.
    render();

    const link = (await tileByCaption('Stuck right now, however long ago')).querySelector('a');
    const href = link?.getAttribute('href') ?? '';
    expect(href).toBe('/tickets?status=BLOCKED');
  });

  it('leaves the resolved-in-period tile unlinked, having no list to match it', async () => {
    render();

    const resolved = await tileByCaption(/Resolved by an engineer in this period/);
    expect(resolved).toHaveTextContent('13');
    expect(resolved.querySelector('a')).toBeNull();
  });
});

describe('the median response times', () => {
  it('calls them medians, because that is what the endpoint computes', async () => {
    render();

    expect(await screen.findByText('Median time to assign')).toBeInTheDocument();
    expect(screen.getByText('Median time to acknowledge')).toBeInTheDocument();
    expect(screen.getByText('Median time to resolve')).toBeInTheDocument();
    expect(screen.queryByText(/^Average time/)).not.toBeInTheDocument();
  });

  it('renders hours under a day as hours and longer ones as days', async () => {
    render();

    expect(await tileByCaption(/89 tickets assigned/)).toHaveTextContent('4h');
    expect(await tileByCaption(/57 tickets resolved/)).toHaveTextContent('1d');
  });
});

describe('the engineer workload table', () => {
  it('says in its own header which column covers the period', async () => {
    render();

    const table = await screen.findByRole('table', { name: 'Engineer workload' });
    expect(within(table).getByText('in the period')).toBeInTheDocument();
    expect(within(table).getByText('Capacity now')).toBeInTheDocument();
  });
});
