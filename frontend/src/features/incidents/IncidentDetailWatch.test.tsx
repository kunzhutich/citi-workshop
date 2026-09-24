import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';

import type { Category, CategoryTree, Incident } from '../../api/types';
import { makeIncident, makeUser } from '../../test/factories';
import { renderWithAuth } from '../../test/renderWithProviders';

/**
 * The other half of "I'm affected too": being able to stop.
 *
 * Subscribing happens from the report questionnaire, where the reporter has
 * never seen the ticket — so the undo cannot live there. It lives on the
 * ticket, which is the one place `is_watching` is a fact the API states rather
 * than something the panel inferred from its own last click.
 *
 * Both the presence rule and its negative are asserted with the same query, on
 * a page first shown to have finished loading. A missing button is what a
 * spinner looks like too (D25), and the ticket page keeps its actions behind a
 * second query for exactly that reason.
 */

function category(id: string, overrides: Partial<Category> = {}): Category {
  return {
    id,
    parent_id: 'g-hardware',
    name: id,
    hint: null,
    icon: null,
    location_detail: 'FLOOR',
    sort_order: 0,
    is_active: true,
    // The base is the conservative answer; every test that is about this
    // flag overrides it explicitly, which is what makes those tests readable.
    allows_watchers: false,
    ...overrides,
  };
}

/** Two subcategories of one group, differing only in the flag. */
const CATEGORY_TREE: CategoryTree = {
  groups: [
    {
      ...category('g-hardware', { parent_id: null }),
      children: [
        category('c-printer', { allows_watchers: true }),
        category('c-keyboard', { allows_watchers: false }),
      ],
    },
  ],
};

vi.mock('../../api/incidents', () => ({
  fetchIncident: vi.fn(),
  fetchAllowedTransitions: vi.fn(),
  fetchActivity: vi.fn(),
  watchIncident: vi.fn(),
  unwatchIncident: vi.fn(),
}));
vi.mock('../../api/categories', () => ({ fetchCategoryTree: vi.fn() }));

const { fetchIncident, fetchAllowedTransitions, fetchActivity, watchIncident, unwatchIncident } =
  await import('../../api/incidents');
const { fetchCategoryTree } = await import('../../api/categories');
const { IncidentDetailPage } = await import('./IncidentDetailPage');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchAllowedTransitions).mockResolvedValue([]);
  vi.mocked(fetchActivity).mockResolvedValue([]);
  vi.mocked(fetchCategoryTree).mockResolvedValue(CATEGORY_TREE);
});

describe('the follow toggle', () => {
  it.each([
    ['c-printer', 1],
    ['c-keyboard', 0],
  ])('under %s, shows the toggle %d time(s)', async (categoryId, expected) => {
    await renderTicket({ categoryId });

    expect(screen.queryAllByRole('button', { name: /affected too|Stop following/ })).toHaveLength(
      expected,
    );
  });

  it('subscribes when pressed, and says what will happen', async () => {
    vi.mocked(watchIncident).mockResolvedValue({ watching: true, watcher_count: 2 });
    await renderTicket({ categoryId: 'c-printer' });

    await userEvent.click(screen.getByRole('button', { name: /affected too/ }));

    await waitFor(() => expect(watchIncident).toHaveBeenCalledWith('t-1'));
    expect(unwatchIncident).not.toHaveBeenCalled();
    expect(await screen.findByText(/told when this ticket moves/)).toBeInTheDocument();
  });

  it('reads the flag off the ticket, not out of the category tree', async () => {
    // The case the tree cannot answer: an admin deactivates "Printer/Scanner"
    // after this ticket was filed against it, so `load_tree` no longer returns
    // it and a lookup would say "no watchers" for a ticket people are already
    // watching. Here the tree says yes for `c-keyboard` and the ticket says
    // no, which only the ticket can be right about.
    await renderTicket({ categoryId: 'c-keyboard', allowsWatchers: true });

    expect(screen.getByRole('button', { name: /affected too/ })).toBeInTheDocument();
  });

  it('unsubscribes when the caller is already following', async () => {
    vi.mocked(unwatchIncident).mockResolvedValue({ watching: false, watcher_count: 1 });
    await renderTicket({ categoryId: 'c-printer', isWatching: true });

    // The label is the action, not the state — which is what makes a single
    // button honest about what pressing it does.
    await userEvent.click(screen.getByRole('button', { name: 'Stop following' }));

    await waitFor(() => expect(unwatchIncident).toHaveBeenCalledWith('t-1'));
    expect(watchIncident).not.toHaveBeenCalled();
  });
});

/** Render one ticket and wait for the page to have finished loading it. */
async function renderTicket({
  categoryId,
  isWatching = false,
  allowsWatchers,
}: {
  categoryId: string;
  isWatching?: boolean;
  /** Overrides the ticket's own flag, to make it disagree with the tree. */
  allowsWatchers?: boolean;
}) {
  const base = makeIncident();
  const ticket: Incident = {
    ...base,
    id: 't-1',
    reference: 'INC-000042',
    title: 'Printer jams on every job',
    category: {
      ...base.category,
      id: categoryId,
      name: categoryId,
      // **The flag comes off the ticket, not out of the category tree**, and
      // that is what this line pins. The tree is still mocked below and still
      // says the same thing for these two ids — so if the page ever went back
      // to looking it up, these tests would pass and the case they exist for
      // would be broken: a ticket filed against a subcategory an admin has
      // since deactivated is not in the tree at all, and its watchers would
      // silently lose the button. The tree and the ticket are made to disagree
      // in the test below that checks exactly that.
      allows_watchers: allowsWatchers ?? categoryId === 'c-printer',
    },
    is_watching: isWatching,
    watcher_count: isWatching ? 1 : 0,
  };
  vi.mocked(fetchIncident).mockResolvedValue(ticket);

  renderWithAuth(
    <Routes>
      <Route path="/tickets/:incidentId" element={<IncidentDetailPage />} />
    </Routes>,
    { user: makeUser(), route: '/tickets/t-1' },
  );

  // Both queries the page gates content behind, not just the first: the
  // actions card is behind `allowed-transitions`, and until it lands every
  // button on the page is absent for every reader.
  await screen.findByRole('heading', { level: 1, name: 'Printer jams on every job' });
  await screen.findByText('There is nothing for you to do on this ticket.');
}
