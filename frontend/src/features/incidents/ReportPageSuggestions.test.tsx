import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CategoryTree, FacilityTree } from '../../api/types';
import {
  makeIncident,
  makeIncidentListItem,
  makeLiveSuggestion,
  makeResolvedSuggestion,
  makeUser,
} from '../../test/factories';
import { renderWithAuth } from '../../test/renderWithProviders';

/**
 * The duplicate-suggestion panel, tested through the questionnaire it lives in.
 *
 * Through `ReportPage` rather than against `SuggestionPanel` alone, because
 * two of the four rules here are about *when* the panel acts and the
 * questionnaire is what supplies the when: the request is not made until a
 * subcategory and a building have been chosen, and the panel is not shown
 * until the location is complete. A test that rendered the panel with its
 * props already filled in would assert neither.
 *
 * **Every negative here is paired with a positive made by the same query.**
 * D24, D25, D35 and D40 are four defects of one shape in this project — a test
 * that asserted something *adjacent* to its intent and was right most of the
 * time — and the shape they share is a negative assertion that an empty page
 * satisfies. "There is no subscribe button" is true of a page that never
 * rendered, so each absence below is asserted on a page that is first shown to
 * contain the card the button would have been on.
 */

const CATEGORY_TREE: CategoryTree = {
  groups: [
    {
      id: 'g-hardware',
      parent_id: null,
      name: 'Hardware',
      hint: "Something physical isn't working",
      icon: 'Computer',
      location_detail: 'FLOOR',
      sort_order: 0,
      is_active: true,
      // On the group, and meaningless there: the flag is read off the
      // subcategory a reporter chose. Present because the type requires it.
      allows_watchers: false,
      children: [
        {
          id: 'c-printer',
          parent_id: 'g-hardware',
          name: 'Printer/Scanner',
          hint: null,
          icon: null,
          location_detail: 'FLOOR',
          sort_order: 0,
          is_active: true,
          // A printer is shared, so other people can say they are affected.
          allows_watchers: true,
        },
        {
          id: 'c-monitor',
          parent_id: 'g-hardware',
          name: 'Monitor',
          hint: null,
          icon: null,
          location_detail: 'FLOOR',
          sort_order: 1,
          is_active: true,
          // A monitor is one person's, and these two differ in nothing else —
          // same group, same `location_detail`, same everything the UI could
          // have guessed from. Only the flag separates them.
          allows_watchers: false,
        },
      ],
    },
  ],
};

const FACILITY_TREE: FacilityTree = {
  buildings: [
    {
      id: 'b1',
      name: 'San Francisco HQ',
      code: 'SFO-1',
      address: null,
      is_active: true,
      floors: [
        {
          id: 'f1',
          building_id: 'b1',
          name: 'Level 3',
          level_number: 3,
          is_active: true,
          seats: [
            { id: 's1', floor_id: 'f1', code: '3-A-01', seat_type: 'DESK', is_active: true },
          ],
        },
      ],
    },
  ],
};

const BASE_LOCATION = makeIncidentListItem().location;

/** The strong claim: this exact desk, an hour ago. */
const SAME_SEAT = makeLiveSuggestion('SEAT', {
  id: 'live-seat',
  reference: 'INC-000111',
  title: 'Printer jams on every job',
  location: {
    ...BASE_LOCATION,
    seat_id: 's1',
    seat_code: '3-A-01',
    seat_type: 'DESK',
    path: 'SFO-1 › Level 3 › 3-A-01',
  },
});

/** The weak one: something printer-ish, somewhere in this building. */
const SAME_BUILDING = makeLiveSuggestion('BUILDING', {
  id: 'live-building',
  reference: 'INC-000222',
  title: 'Printer offline in the west wing',
  location: { ...BASE_LOCATION, floor_id: 'f9', floor_name: 'Level 1', path: 'SFO-1 › Level 1' },
});

const ALREADY_FIXED = makeResolvedSuggestion('FLOOR', {
  id: 'fixed-1',
  reference: 'INC-000333',
  title: 'Printer kept jamming on Level 3',
  resolution_summary: 'Cleared a torn sheet from the fuser and reset the paper tray.',
});

vi.mock('../../api/categories', () => ({ fetchCategoryTree: vi.fn() }));
vi.mock('../../api/facilities', () => ({ fetchFacilityTree: vi.fn() }));
vi.mock('../../api/incidents', () => ({
  createIncident: vi.fn(),
  fetchIncidentSuggestions: vi.fn(),
  watchIncident: vi.fn(),
  unwatchIncident: vi.fn(),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

const { fetchCategoryTree } = await import('../../api/categories');
const { fetchFacilityTree } = await import('../../api/facilities');
const { createIncident, fetchIncidentSuggestions, watchIncident } = await import(
  '../../api/incidents'
);
const { ReportPage } = await import('./ReportPage');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchCategoryTree).mockResolvedValue(CATEGORY_TREE);
  vi.mocked(fetchFacilityTree).mockResolvedValue(FACILITY_TREE);
  vi.mocked(createIncident).mockResolvedValue(
    makeIncident({ id: 'new-id', reference: 'INC-000482' }),
  );
  // Nothing found is the ordinary answer, and the one every test that is not
  // about the panel should get.
  vi.mocked(fetchIncidentSuggestions).mockResolvedValue({ live: [], resolved: [] });
});

describe('when the question is asked', () => {
  it('asks nothing until it has both a subcategory and a building, then asks', async () => {
    await renderReportPage();

    await userEvent.click(screen.getByRole('button', { name: /^Hardware/ }));
    expect(fetchIncidentSuggestions).not.toHaveBeenCalled();

    // A subcategory on its own is not a question: there is no "where" in it.
    await userEvent.click(screen.getByRole('button', { name: 'Printer/Scanner' }));
    expect(fetchIncidentSuggestions).not.toHaveBeenCalled();

    await chooseBuilding();
    await waitFor(() => expect(fetchIncidentSuggestions).toHaveBeenCalled());
    // The building alone is enough — the floor this group also asks for has
    // not been given yet. Asking at the earlier moment is what puts the answer
    // in hand before the panel is allowed to appear.
    expect(vi.mocked(fetchIncidentSuggestions).mock.calls[0][0]).toEqual({
      category_id: 'c-printer',
      building_id: 'b1',
      floor_id: null,
      seat_id: null,
    });

    await chooseFloor();
    await waitFor(() => expect(fetchIncidentSuggestions).toHaveBeenCalledTimes(2));
    expect(vi.mocked(fetchIncidentSuggestions).mock.calls[1][0]).toMatchObject({
      floor_id: 'f1',
    });
  });

  it('shows nothing at all when both lists come back empty', async () => {
    await reachTheSuggestions();

    // Asserted only after the request has provably been answered, so this is
    // a statement about an empty answer and not about an unfinished page.
    await waitFor(() => expect(fetchIncidentSuggestions).toHaveBeenCalled());
    expect(screen.getByText('Tell us more')).toBeInTheDocument();
    expect(screen.queryByText('Before you carry on')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Still open/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Fixed before/ })).not.toBeInTheDocument();
  });
});

describe('two lists that make two different claims', () => {
  beforeEach(() => {
    vi.mocked(fetchIncidentSuggestions).mockResolvedValue({
      live: [SAME_SEAT, SAME_BUILDING],
      resolved: [ALREADY_FIXED],
    });
  });

  it('keeps what is still open apart from what was fixed before', async () => {
    await reachTheSuggestions();

    const open = await screen.findByRole('region', { name: /Still open/ });
    const fixed = screen.getByRole('region', { name: /Fixed before/ });

    expect(within(open).getByRole('article', { name: 'INC-000111' })).toBeInTheDocument();
    expect(within(open).getByRole('article', { name: 'INC-000222' })).toBeInTheDocument();
    expect(within(open).queryByRole('article', { name: 'INC-000333' })).not.toBeInTheDocument();

    expect(within(fixed).getByRole('article', { name: 'INC-000333' })).toBeInTheDocument();
    expect(within(fixed).queryByRole('article', { name: 'INC-000111' })).not.toBeInTheDocument();
  });

  it('shows the resolved ticket’s summary, which is the whole point of it', async () => {
    await reachTheSuggestions();

    const fixed = await screen.findByRole('region', { name: /Fixed before/ });
    const card = within(fixed).getByRole('article', { name: 'INC-000333' });

    expect(
      within(card).getByText('Cleared a torn sheet from the fuser and reset the paper tray.'),
    ).toBeInTheDocument();
  });

  it('says on each card how close it is, so a desk is not read as a building', async () => {
    await reachTheSuggestions();

    const open = await screen.findByRole('region', { name: /Still open/ });
    const sameSeat = within(open).getByRole('article', { name: 'INC-000111' });
    const sameBuilding = within(open).getByRole('article', { name: 'INC-000222' });

    // Both halves. That the strong claim says "Same desk" is easy; that the
    // weak one does not also say it is what stops the list flattening into
    // one undifferentiated pile.
    expect(within(sameSeat).getByText('Same desk')).toBeInTheDocument();
    expect(within(sameSeat).queryByText('Same building')).not.toBeInTheDocument();
    expect(within(sameBuilding).getByText('Same building')).toBeInTheDocument();
    expect(within(sameBuilding).queryByText('Same desk')).not.toBeInTheDocument();
  });

  it('opens a suggestion in a new tab, because the form behind it is half filled', async () => {
    await reachTheSuggestions();

    const open = await screen.findByRole('region', { name: /Still open/ });
    const link = within(open).getByRole('link', { name: /INC-000111/ });

    expect(link).toHaveAttribute('href', '/tickets/live-seat');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('never stands between the reporter and the report', async () => {
    await reachTheSuggestions();

    // The panel is provably on screen *before* the thing it must not prevent,
    // so a green result cannot mean the suggestions never arrived.
    expect(await screen.findByText('Before you carry on')).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'INC-000111' })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Title/), 'Printer jams on every job');
    await userEvent.type(
      screen.getByLabelText(/What happened\?/),
      'It jams on the third page, every single time.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Report this issue' }));

    await waitFor(() => expect(createIncident).toHaveBeenCalled());
    expect(vi.mocked(createIncident).mock.calls[0][0]).toMatchObject({
      category_id: 'c-printer',
      building_id: 'b1',
      floor_id: 'f1',
    });
    expect(navigate).toHaveBeenCalledWith('/tickets/new-id');
    // And it was still there the whole way: nothing was hidden to let the
    // form through, which is the other way a panel could "not block".
    expect(screen.getByRole('article', { name: 'INC-000111' })).toBeInTheDocument();
  });
});

describe('“I’m affected too”', () => {
  beforeEach(() => {
    vi.mocked(fetchIncidentSuggestions).mockResolvedValue({ live: [SAME_SEAT], resolved: [] });
  });

  /*
   * The two cases differ in one thing: which subcategory was chosen, and so
   * what `allows_watchers` says. Same fixtures, same suggestion, same
   * assertion — `queryAllByRole(…)` counted — so neither result can be an
   * artefact of a query that suits one case better than the other. The card
   * is waited for in both, which is what makes the zero mean "the flag is
   * false" rather than "nothing had rendered yet".
   */
  it.each([
    ['Printer/Scanner', 1],
    ['Monitor', 0],
  ])('under %s, offers the subscribe control %d time(s)', async (subcategory, expected) => {
    await reachTheSuggestions(subcategory);

    expect(await screen.findByRole('article', { name: 'INC-000111' })).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /affected too/i })).toHaveLength(expected);
  });

  it('subscribes to the ticket whose button was pressed, and confirms it', async () => {
    vi.mocked(fetchIncidentSuggestions).mockResolvedValue({
      live: [SAME_SEAT, SAME_BUILDING],
      resolved: [],
    });
    vi.mocked(watchIncident).mockResolvedValue({ watching: true, watcher_count: 4 });
    await reachTheSuggestions();

    const sameBuilding = await screen.findByRole('article', { name: 'INC-000222' });
    await userEvent.click(within(sameBuilding).getByRole('button', { name: /affected too/i }));

    await waitFor(() => expect(watchIncident).toHaveBeenCalledWith('live-building'));
    expect(await within(sameBuilding).findByText(/4 people are affected/)).toBeInTheDocument();

    // The other card is untouched. The state belongs to one ticket, not to
    // the panel — a single flag would have confirmed both at once.
    const sameSeat = screen.getByRole('article', { name: 'INC-000111' });
    expect(within(sameSeat).getByRole('button', { name: /affected too/i })).toBeInTheDocument();
  });
});

/** Render the questionnaire and wait for its two reference trees. */
async function renderReportPage() {
  renderWithAuth(<ReportPage />, { user: makeUser() });
  await screen.findByRole('button', { name: /^Hardware/ });
}

/** Answer questions 1 to 3, which is everything the panel depends on. */
async function reachTheSuggestions(subcategory = 'Printer/Scanner') {
  await renderReportPage();
  await userEvent.click(screen.getByRole('button', { name: /^Hardware/ }));
  await userEvent.click(screen.getByRole('button', { name: subcategory }));
  await chooseBuilding();
  await chooseFloor();
}

async function chooseBuilding() {
  await userEvent.click(screen.getByLabelText(/Building/));
  await userEvent.click(screen.getByRole('option', { name: /SFO-1/ }));
}

async function chooseFloor() {
  await userEvent.click(screen.getByLabelText(/Floor/));
  await userEvent.click(screen.getByRole('option', { name: 'Level 3' }));
}
