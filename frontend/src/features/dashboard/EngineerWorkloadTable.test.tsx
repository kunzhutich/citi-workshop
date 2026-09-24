import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { EngineerWorkload } from '../../api/reports';
import { makeAdmin } from '../../test/factories';
import { renderWithAuth } from '../../test/renderWithProviders';
import { EngineerWorkloadTable } from './EngineerWorkloadTable';

/**
 * Three destinations in one row, and the row is only one of them.
 *
 * The row opens the engineer's page (§6.1). The capacity bar opens their live
 * queue and the resolved count opens the tickets behind that number — both
 * anchors, which is what `useRowNavigation` declines to act on. Get that guard
 * wrong and the failure is not a dead link but a *silent* one: the anchor
 * navigates, the row handler then navigates again, and the last one wins. The
 * reader lands on the engineer's page from every cell and the two links look
 * broken.
 *
 * So each test asserts the path it arrived at rather than that it moved,
 * which is the lesson of D24/D25/D35/D40 applied to navigation: "something
 * happened" is true of the wrong destination too.
 */

const PERIOD_FROM = '2026-08-24';
const PERIOD_TO = '2026-09-23';

/** Every count differs, so a test cannot match the wrong cell by luck. */
const PRIYA: EngineerWorkload = {
  user_id: 'engineer-9',
  full_name: 'Priya Patel',
  level: 'SENIOR',
  availability: 'AVAILABLE',
  max_active_tickets: 10,
  open_count: 7,
  in_progress_count: 3,
  blocked_count: 1,
  active_count: 11,
  capacity_used_pct: 110,
  resolved_in_period: 24,
};

/** The router's current location, path and query string together. */
function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

function renderTable() {
  renderWithAuth(
    <>
      <EngineerWorkloadTable
        engineers={[PRIYA]}
        periodFrom={PERIOD_FROM}
        periodTo={PERIOD_TO}
        buildingId=""
      />
      <LocationProbe />
    </>,
    { user: makeAdmin(), route: '/' },
  );
}

/** Where the router is now. */
function currentLocation(): string {
  return screen.getByTestId('location').textContent ?? '';
}

describe('a workload row', () => {
  it('opens the engineer from a cell that is not a link', async () => {
    renderTable();

    // The blocked count: a plain `<td>` with no control in it.
    await userEvent.click(screen.getByText('1'));

    expect(currentLocation()).toBe('/engineers/engineer-9');
  });

  it('keeps the name a real link, so the row is reachable without a pointer', () => {
    renderTable();

    expect(screen.getByRole('link', { name: 'Priya Patel' })).toHaveAttribute(
      'href',
      '/engineers/engineer-9',
    );
  });

  it('sends the capacity bar to their live queue, not to their page', async () => {
    renderTable();

    await userEvent.click(screen.getByRole('link', { name: "Priya Patel's current queue" }));

    expect(currentLocation()).toBe(
      '/tickets?assignee_id=engineer-9&status=OPEN&status=IN_PROGRESS&status=BLOCKED',
    );
  });

  it('sends the resolved count to the tickets it counted, dates and all', async () => {
    renderTable();

    await userEvent.click(screen.getByRole('link', { name: '24' }));

    expect(currentLocation()).toBe(
      '/tickets?assignee_id=engineer-9&status=RESOLVED&status=CLOSED' +
        `&created_from=${PERIOD_FROM}&created_to=${PERIOD_TO}`,
    );
  });
});
