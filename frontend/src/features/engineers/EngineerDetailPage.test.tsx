import userEvent from '@testing-library/user-event';
import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EngineerDetailReport } from '../../api/reports';
import type {
  CategoryTree,
  Engineer,
  FacilityTree,
  IncidentListItem,
  Page,
} from '../../api/types';
import { makeAdmin, makeEngineerRow, makeIncidentListItem } from '../../test/factories';
import { renderWithAuth } from '../../test/renderWithProviders';

vi.mock('../../api/engineers', () => ({
  getEngineer: vi.fn(),
  listEngineers: vi.fn(),
  updateEngineer: vi.fn(),
}));
vi.mock('../../api/reports', () => ({ fetchEngineerDetail: vi.fn() }));
vi.mock('../../api/incidents', () => ({ listIncidents: vi.fn() }));
vi.mock('../../api/facilities', () => ({ fetchFacilityTree: vi.fn() }));
vi.mock('../../api/categories', () => ({ fetchCategoryTree: vi.fn() }));

const { getEngineer, listEngineers } = await import('../../api/engineers');
const { fetchEngineerDetail } = await import('../../api/reports');
const { listIncidents } = await import('../../api/incidents');
const { fetchFacilityTree } = await import('../../api/facilities');
const { fetchCategoryTree } = await import('../../api/categories');
const { EngineerDetailPage } = await import('./EngineerDetailPage');

/**
 * The two halves of this screen are in different tenses, and the layout is
 * the only thing left saying so.
 *
 * Until R7 a sentence under the filter bar said it — "the dates apply to the
 * figures below; what they are holding right now is counted however old it
 * is" — and the period heading repeated it with dates. R7 moved the date
 * controls down beside the heading they scope and took both sentences away,
 * which means the claim D9 makes about this data is now carried entirely by
 * where things sit: a "Right now" label over the capacity bar and the live
 * queue, an "Over the selected period" label over the tiles and the chart.
 *
 * These tests therefore assert *placement*, not presence. "The page says
 * Right now somewhere" would pass with the label at the bottom of the screen,
 * under the tiles it contradicts, which is exactly the class of
 * nearly-right assertion D24, D25, D35 and D40 were each written about.
 */

const ENGINEER: Engineer = makeEngineerRow({
  user_id: 'eng-1',
  full_name: 'Priya Raman',
  email: 'priya.raman@acme.inc',
  level: 'LEAD',
  // Over the ceiling on purpose: the soft limit is the interesting case, and
  // "17 / 15" cannot be confused with any other number on the screen.
  active_ticket_count: 17,
  max_active_tickets: 15,
});

/**
 * Eight category groups, because the demo database has eight.
 *
 * D57 caps a pie at three categorical slice colours. This is the data the
 * chart is actually asked to draw, so the test draws it too rather than
 * flattering the chart with three rows.
 */
const GROUP_NAMES = [
  'Hardware',
  'Software',
  'Network & Access',
  'Meeting Rooms',
  'Building & Facilities',
  'Cleaning & Waste',
  'Safety & Security',
  'Deliveries & Moves',
];

const REPORT: EngineerDetailReport = {
  window: { from: '2026-08-24T00:00:00Z', to: '2026-09-23T00:00:00Z', building_id: null },
  user_id: 'eng-1',
  resolved_in_period: 41,
  closed_in_period: 33,
  reopened_in_period: 4,
  reopen_rate_pct: 9.8,
  resolved_by_group: GROUP_NAMES.map((name, index) => ({
    group_id: `g-${index}`,
    group_name: name,
    count: 12 - index,
  })),
};

/** The ticket they are holding now. Named so it cannot be mistaken for the other. */
const LIVE_TICKET = makeIncidentListItem({
  id: 'live-1',
  title: 'Lift stuck between floors two and three',
});

/** A ticket from the table at the bottom, which lists finished work too. */
const HISTORIC_TICKET = makeIncidentListItem({
  id: 'old-1',
  title: 'Badge reader offline at the north door',
  status: 'CLOSED',
});

const FACILITIES: FacilityTree = { buildings: [] };
const CATEGORIES: CategoryTree = { groups: [] };

function page<T>(items: T[], total = items.length): Page<T> {
  return { items, total, page: 1, page_size: 25 };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEngineer).mockResolvedValue(ENGINEER);
  vi.mocked(fetchEngineerDetail).mockResolvedValue(REPORT);
  vi.mocked(listEngineers).mockResolvedValue(page<Engineer>([]));
  vi.mocked(fetchFacilityTree).mockResolvedValue(FACILITIES);
  vi.mocked(fetchCategoryTree).mockResolvedValue(CATEGORIES);
  // Two lists on one screen, and only the query tells them apart: the live
  // queue asks for three statuses, the table at the bottom asks for finished
  // work last. Returning the same rows for both would let a test pass with
  // the two lists swapped.
  vi.mocked(listIncidents).mockImplementation((query) =>
    Promise.resolve(
      query.closed_last
        ? page<IncidentListItem>([HISTORIC_TICKET])
        : page<IncidentListItem>([LIVE_TICKET], 17),
    ),
  );
});

function render(route = '/engineers/eng-1') {
  return renderWithAuth(
    <Routes>
      <Route path="/engineers/:userId" element={<EngineerDetailPage />} />
    </Routes>,
    { user: makeAdmin(), route },
  );
}

/** Wait until every one of the page's four queries has painted something. */
async function renderLoaded(route?: string) {
  const result = render(route);
  await screen.findByRole('heading', { name: 'Priya Raman' });
  await screen.findByText('Resolved');
  await screen.findByText(LIVE_TICKET.title);
  await screen.findByText(HISTORIC_TICKET.title);
  return result;
}

describe('which half the date range reaches', () => {
  it('states the period without dating it, the picker beside the heading having them', async () => {
    /*
     * The twin of this assertion is in `AdminDashboardPage.test.tsx`, which
     * asserts the dated caption is still drawn there, and in
     * `ScopeHeading.test.tsx`, which asserts the default draws it at all.
     * On its own this one would pass just as well if the caption had been
     * deleted from `ScopeHeading` for every screen in the application.
     */
    await renderLoaded();

    expect(screen.queryByText(/Counted over/)).not.toBeInTheDocument();
    // And nothing else took its place saying the same thing in other words.
    expect(screen.queryByText(/The dates apply to the figures/)).not.toBeInTheDocument();
    expect(screen.queryByText(/The building applies to everything below/)).not.toBeInTheDocument();
  });

  it('labels the live half "Right now", over the capacity bar and that queue', async () => {
    await renderLoaded();

    const liveHalf = screen.getByTestId('scope-label-current').parentElement;
    expect(liveHalf).not.toBeNull();
    const live = within(liveHalf as HTMLElement);

    expect(live.getByText('Right now')).toBeInTheDocument();
    expect(live.getByLabelText('17 of 15 tickets')).toBeInTheDocument();
    expect(live.getByText('On their plate now')).toBeInTheDocument();
    expect(live.getByText(LIVE_TICKET.title)).toBeInTheDocument();

    // The figures the date range *does* reach are not in this column. Without
    // this the label would still pass sitting above the whole page.
    expect(live.queryByText('Resolved, then reopened')).not.toBeInTheDocument();
    expect(live.queryByText('What they fix')).not.toBeInTheDocument();
  });

  it('labels the other half "Over the selected period", above the tiles and the chart', async () => {
    await renderLoaded();

    const heading = screen
      .getByTestId('scope-label-period')
      .closest('[data-testid="period-scope-heading"]');
    expect(heading).not.toBeNull();
    expect(heading).toHaveTextContent('What they got through');

    // Above, not merely near: the tiles and the chart follow it in the
    // document, which is what "over" means to a reader and to a screen reader.
    const tile = screen.getByText('Resolved, then reopened');
    const chart = screen.getByText('What they fix');
    for (const node of [tile, chart]) {
      expect((heading as HTMLElement).compareDocumentPosition(node)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
  });

  it('puts the date range and the building picker inside that heading', async () => {
    // D2: they scope one half of the page, so they sit with its heading
    // rather than above the whole screen where they would appear to reach
    // the live queue as well.
    await renderLoaded();

    const heading = screen.getByTestId('period-scope-heading');
    expect(within(heading).getByLabelText('Date range')).toBeInTheDocument();
    expect(within(heading).getByLabelText('Building')).toBeInTheDocument();
  });
});

describe('the page’s headings', () => {
  it('has exactly one h1, and it is the engineer', async () => {
    // The ticket table at the bottom is `IncidentsPage`, which is an entire
    // screen everywhere else and titles itself with an `h1` there.
    await renderLoaded();

    const topLevel = screen.getAllByRole('heading', { level: 1 });
    expect(topLevel).toHaveLength(1);
    expect(topLevel[0]).toHaveTextContent('Priya Raman');
  });

  it('shows the level beside the name rather than at the far end of the row', async () => {
    await renderLoaded();

    const title = screen.getByRole('heading', { name: 'Priya Raman' });
    expect(title.parentElement).toHaveTextContent('Lead');
  });
});

describe('the ticket table at the bottom', () => {
  it('is `IncidentsPage`, asking for this engineer with finished work last', async () => {
    await renderLoaded();

    expect(vi.mocked(listIncidents)).toHaveBeenCalledWith(
      expect.objectContaining({ assignee_id: 'eng-1', closed_last: true }),
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Their tickets' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Tickets' })).toBeInTheDocument();
  });

  it('says the date range above does not reach it, because it does not', async () => {
    // A third scope on one screen. The period label sits above this table in
    // the document, and a reader who took it to cover the table would be
    // reading a list of every ticket this person has ever had as a month's
    // work.
    await renderLoaded();

    expect(screen.getByText(/the date range above does not\s+reach it/)).toBeInTheDocument();
    const [firstCall] = vi
      .mocked(listIncidents)
      .mock.calls.filter(([query]) => query.closed_last);
    // `toQuery` emits the key whatever happens, so the assertion is on the
    // value: the dashboard's picker writes no `created_from`/`created_to`,
    // and it is `useIncidentFilters` that would have to carry them here.
    expect(firstCall[0].created_from).toBeUndefined();
    expect(firstCall[0].created_to).toBeUndefined();
  });
});

describe('what they fix', () => {
  /**
   * The pie folds and the table does not, and the pair is the claim.
   *
   * D57 caps a categorical pie at three validated slice colours, and this
   * engineer resolved in eight groups. Drawn unfolded every slice takes the
   * single series colour, which is right for a bar — its length carries the
   * magnitude — and useless for a pie: a ring of one hue beside a legend of
   * one hue. So `foldToCategoricalSlices` keeps the top three and folds the
   * rest into one neutral.
   *
   * What must **not** also happen is the groups disappearing. The fold reaches
   * the chart and stops there; the table twin one button away still lists all
   * eight with their links, which is where a reader goes for values and is the
   * relief case the neutral's contrast leans on. Asserting only the first half
   * would pass against a chart that had silently dropped five categories —
   * which is the failure this pair exists to catch, not the one it is about.
   */
  it('folds the pie to the colours the palette validated', async () => {
    await renderLoaded();

    const chart = screen.getByRole('img', { name: /Pie chart: What they fix/ });
    expect(chart).toHaveAccessibleName(/4 rows/);
    expect(chart).toHaveAccessibleName(/5 other groups/);
    expect(chart).toHaveAccessibleName(/Use "Show as a table" for every value/);
  });

  it('still lists every group, with its link, in the table view', async () => {
    await renderLoaded();

    // Scoped by the toggle group's own name, because there are two of these
    // cards on the page and `Show as a table` is the label on both.
    const toggle = screen.getByRole('group', { name: 'How to show What they fix' });
    await userEvent.click(within(toggle).getByRole('button', { name: 'Show as a table' }));

    const table = await screen.findByRole('table', { name: /What they fix, as a table/ });
    // Eight, not four: the header row plus one per group.
    expect(within(table).getAllByRole('row')).toHaveLength(9);
    // And the two smallest — the ones the pie folded away — are still links.
    expect(within(table).getByRole('link', { name: 'Deliveries & Moves' })).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'Safety & Security' })).toBeInTheDocument();
  });
});
