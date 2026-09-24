import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FacilityTree, CategoryTree, Engineer, IncidentListItem, Page } from '../../api/types';
import { makeAdmin, makeIncidentListItem } from '../../test/factories';
import { renderWithAuth } from '../../test/renderWithProviders';

vi.mock('../../api/incidents', () => ({ listIncidents: vi.fn() }));
vi.mock('../../api/facilities', () => ({ fetchFacilityTree: vi.fn() }));
vi.mock('../../api/categories', () => ({ fetchCategoryTree: vi.fn() }));
vi.mock('../../api/engineers', () => ({ listEngineers: vi.fn() }));

const { listIncidents } = await import('../../api/incidents');
const { fetchFacilityTree } = await import('../../api/facilities');
const { fetchCategoryTree } = await import('../../api/categories');
const { listEngineers } = await import('../../api/engineers');
const { IncidentsPage } = await import('./IncidentsPage');

const TICKET = makeIncidentListItem({ title: 'Badge reader offline at the north door' });

const FACILITIES: FacilityTree = { buildings: [] };
const CATEGORIES: CategoryTree = { groups: [] };

function page<T>(items: T[]): Page<T> {
  return { items, total: items.length, page: 1, page_size: 25 };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listIncidents).mockResolvedValue(page<IncidentListItem>([TICKET]));
  vi.mocked(fetchFacilityTree).mockResolvedValue(FACILITIES);
  vi.mocked(fetchCategoryTree).mockResolvedValue(CATEGORIES);
  vi.mocked(listEngineers).mockResolvedValue(page<Engineer>([]));
});

/**
 * The list screen, and the one thing that changes when it is not the screen.
 *
 * R7 put a ticket table inside the engineer page rather than building a second
 * one, which is the whole point of this component taking a preset. What it
 * could not bring with it is its `PageHeader`: that renders an `h1` by
 * construction, and the engineer page already has one. Two `h1`s in a document
 * is an accessibility defect, and `e2e/accessibility.spec.ts` would not
 * necessarily have reported it — axe's `page-has-heading-one` fires on *none*,
 * not on two.
 *
 * Both halves are asserted here on purpose. `embedded` making the heading
 * disappear is easy; `embedded` defaulting to off, so that My Tickets, All
 * Tickets, My Queue and Unassigned keep the `h1` they have always had, is the
 * half that would fail silently on all four screens at once.
 */
function render(props: Partial<Parameters<typeof IncidentsPage>[0]> = {}) {
  return renderWithAuth(
    <IncidentsPage
      title="My queue"
      description="The tickets assigned to you, with finished work last."
      emptyTitle="Nothing is assigned to you"
      emptyDescription="Work assigned to you by a lead or an admin appears here."
      {...props}
    />,
    { user: makeAdmin() },
  );
}

describe('a list that is the whole screen', () => {
  it('titles itself with the page’s h1', async () => {
    render();

    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('My queue');
    expect(
      screen.queryByRole('heading', { level: 2, name: 'My queue' }),
    ).not.toBeInTheDocument();
  });
});

describe('a list embedded in a larger page', () => {
  it('titles itself with an h2 and claims no h1', async () => {
    render({ embedded: true });

    expect(
      await screen.findByRole('heading', { level: 2, name: 'My queue' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('still says what it is for, under the heading', async () => {
    render({ embedded: true, description: 'Everything ever assigned to them.' });

    expect(await screen.findByText('Everything ever assigned to them.')).toBeInTheDocument();
  });

  it('brings its filter bar, its table and its paging with it', async () => {
    // The reason to reuse this component rather than build a second table.
    // If `embedded` ever started trimming more than the heading, this is the
    // assertion that would say so.
    render({ embedded: true });

    expect(await screen.findByRole('table', { name: 'Tickets' })).toBeInTheDocument();
    expect(screen.getByText('Badge reader offline at the north door')).toBeInTheDocument();
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to next page' })).toBeInTheDocument();
  });
});
