import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CategoryTree, FacilityTree } from '../../api/types';
import { makeIncident, makeUser } from '../../test/factories';
import { renderWithAuth } from '../../test/renderWithProviders';

/**
 * The questionnaire's progressive reveal, and what it sends.
 *
 * The API modules are mocked rather than the network, so these tests state
 * exactly what the server returned and read exactly what the form posted. The
 * rules under test are the frontend's: which question appears when, and which
 * location fields the chosen group asks for.
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
      children: [
        {
          id: 'c-monitor',
          parent_id: 'g-hardware',
          name: 'Monitor',
          hint: null,
          icon: null,
          location_detail: 'FLOOR',
          sort_order: 0,
          is_active: true,
        },
      ],
    },
    {
      id: 'g-software',
      parent_id: null,
      name: 'Software',
      hint: 'An app, email, or your operating system',
      icon: 'Apps',
      location_detail: 'BUILDING',
      sort_order: 1,
      is_active: true,
      children: [
        {
          id: 'c-email',
          parent_id: 'g-software',
          name: 'Email/Calendar',
          hint: null,
          icon: null,
          location_detail: 'BUILDING',
          sort_order: 0,
          is_active: true,
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

const fetchCategoryTree = vi.fn();
const fetchFacilityTree = vi.fn();
const createIncident = vi.fn();
const navigate = vi.fn();

vi.mock('../../api/categories', () => ({
  fetchCategoryTree: (...args: unknown[]) => fetchCategoryTree(...args),
}));
vi.mock('../../api/facilities', () => ({
  fetchFacilityTree: (...args: unknown[]) => fetchFacilityTree(...args),
}));
vi.mock('../../api/incidents', () => ({
  createIncident: (...args: unknown[]) => createIncident(...args),
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

// Imported after the mocks, so the module graph picks them up.
const { ReportPage } = await import('./ReportPage');

beforeEach(() => {
  vi.clearAllMocks();
  fetchCategoryTree.mockResolvedValue(CATEGORY_TREE);
  fetchFacilityTree.mockResolvedValue(FACILITY_TREE);
  createIncident.mockResolvedValue(makeIncident({ id: 'new-id', reference: 'INC-000482' }));
});

/** Render the form and wait for the two reference trees to arrive. */
async function renderReportPage() {
  renderWithAuth(<ReportPage />, { user: makeUser() });
  await screen.findByRole('button', { name: /^Hardware/ });
}

describe('progressive reveal', () => {
  it('asks only the first question to begin with', async () => {
    await renderReportPage();

    expect(screen.getByText('What kind of problem is it?')).toBeInTheDocument();
    expect(screen.queryByText('Which one?')).not.toBeInTheDocument();
    expect(screen.queryByText('Where?')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Report this issue' })).not.toBeInTheDocument();
  });

  it('reveals the next question as each is answered', async () => {
    await renderReportPage();

    await userEvent.click(screen.getByRole('button', { name: /^Hardware/ }));
    expect(screen.getByText('Which one?')).toBeInTheDocument();
    expect(screen.queryByText('Where?')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Monitor' }));
    expect(screen.getByText('Where?')).toBeInTheDocument();
    expect(screen.queryByText('Tell us more')).not.toBeInTheDocument();
  });

  it('lets a reporter go back and change the group, clearing the subcategory', async () => {
    // The reason it is one page rather than a wizard.
    await renderReportPage();

    await userEvent.click(screen.getByRole('button', { name: /^Hardware/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Monitor' }));
    expect(screen.getByText('Where?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '← Change' }));

    // Awaited, because the sections now close rather than vanish. R5 wrapped
    // each one in a `Collapse` with `unmountOnExit`, so the content leaves the
    // DOM when the exit transition ends and not on the click that started it.
    // Still an assertion about removal, not about visibility — `unmountOnExit`
    // is what keeps a closed question out of the accessibility tree instead of
    // merely out of sight.
    await waitFor(() => {
      expect(screen.queryByText('Which one?')).not.toBeInTheDocument();
      expect(screen.queryByText('Where?')).not.toBeInTheDocument();
    });
  });

  it('holds the submit button back until every question is answered', async () => {
    await renderReportPage();

    await userEvent.click(screen.getByRole('button', { name: /^Hardware/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Monitor' }));
    await chooseLocation();

    expect(screen.getByText('Tell us more')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Report this issue' })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Title/), 'Monitor flickers');
    await userEvent.type(
      screen.getByLabelText(/What happened\?/),
      'It blanks for a second every few minutes.',
    );

    expect(screen.getByRole('button', { name: 'Report this issue' })).toBeInTheDocument();
  });
});

describe('the location the group asks for', () => {
  it('asks a FLOOR group for a floor', async () => {
    await renderReportPage();

    await userEvent.click(screen.getByRole('button', { name: /^Hardware/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Monitor' }));

    expect(screen.getByLabelText(/Building/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Floor/)).toBeInTheDocument();
  });

  it('asks a BUILDING group for a building alone', async () => {
    await renderReportPage();

    await userEvent.click(screen.getByRole('button', { name: /^Software/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Email/Calendar' }));

    expect(screen.getByLabelText(/Building/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Floor/)).not.toBeInTheDocument();
  });
});

describe('submitting', () => {
  it('posts what was collected and lands on the new ticket', async () => {
    await renderReportPage();

    await userEvent.click(screen.getByRole('button', { name: /^Hardware/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Monitor' }));
    await chooseLocation();
    await userEvent.type(screen.getByLabelText(/Title/), 'Monitor flickers badly');
    await userEvent.type(
      screen.getByLabelText(/What happened\?/),
      'It blanks for a second every few minutes.',
    );
    await userEvent.click(screen.getByRole('button', { name: /^High/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Report this issue' }));
    // Asserted on the first argument, not with `toHaveBeenCalledWith`:
    // TanStack Query v5 calls a `mutationFn` with `(variables, context)`, so
    // the payload arrives alongside a second argument the test does not care
    // about.
    await waitFor(() => expect(createIncident).toHaveBeenCalled());
    expect(createIncident.mock.calls[0][0]).toEqual({
      title: 'Monitor flickers badly',
      description: 'It blanks for a second every few minutes.',
      category_id: 'c-monitor',
      building_id: 'b1',
      floor_id: 'f1',
      seat_id: null,
      priority: 'HIGH',
    });
    expect(navigate).toHaveBeenCalledWith('/tickets/new-id');
    expect(await screen.findByText('INC-000482 created.')).toBeInTheDocument();
  });

  it('defaults to medium, which is what most problems are', async () => {
    await renderReportPage();

    await userEvent.click(screen.getByRole('button', { name: /^Hardware/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Monitor' }));
    await chooseLocation();
    await userEvent.type(screen.getByLabelText(/Title/), 'Monitor flickers badly');
    await userEvent.type(
      screen.getByLabelText(/What happened\?/),
      'It blanks for a second every few minutes.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Report this issue' }));

    await waitFor(() => expect(createIncident).toHaveBeenCalled());
    expect(createIncident.mock.calls[0][0]).toMatchObject({ priority: 'MEDIUM' });
  });

  it('refuses a description the API would refuse, without asking it', async () => {
    await renderReportPage();

    await userEvent.click(screen.getByRole('button', { name: /^Hardware/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Monitor' }));
    await chooseLocation();
    await userEvent.type(screen.getByLabelText(/Title/), 'Monitor flickers badly');
    await userEvent.type(screen.getByLabelText(/What happened\?/), 'too short');
    await userEvent.click(screen.getByRole('button', { name: 'Report this issue' }));

    expect(await screen.findByText(/at least 10 characters/)).toBeInTheDocument();
    expect(createIncident).not.toHaveBeenCalled();
  });
});

/** Choose the building and floor the fixture offers. */
async function chooseLocation() {
  await userEvent.click(screen.getByLabelText(/Building/));
  await userEvent.click(screen.getByRole('option', { name: /SFO-1/ }));
  await userEvent.click(screen.getByLabelText(/Floor/));
  await userEvent.click(screen.getByRole('option', { name: 'Level 3' }));
}
