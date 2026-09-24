import Button from '@mui/material/Button';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeAdmin, makeEngineerRow } from '../../test/factories';
import { renderWithAuth } from '../../test/renderWithProviders';
import { EngineerRoster } from './EngineerRoster';

/**
 * The roster's clickable rows, and the action that must survive them.
 *
 * The row opens that engineer's page (`components/rowNavigation.ts`), and
 * Deactivate — the one control left in the Actions column now that Edit has
 * gone to the engineer's own page — has to keep working *through* it. Those
 * two are the failure mode of a clickable row: either the row swallows the
 * button, or the button's click also navigates and the admin lands somewhere
 * they did not ask for.
 *
 * So every test here asserts a **destination**, not merely that something
 * happened. D24, D25, D35 and D40 are four defects of one shape — an assertion
 * made against something adjacent to its intent, true most of the time — and
 * "the page did not navigate" is exactly that shape when it stands alone: it
 * is also true of a roster that failed to render. Each case below pairs it
 * with the positive claim that the button did its own job.
 */

const SAM = makeEngineerRow({
  user_id: 'engineer-1',
  full_name: 'Sam Senior',
  email: 'sam.senior@acme.inc',
});

/** The router's current location, so a test can say where a click led. */
function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}</p>;
}

/** Render the roster as the Engineers screen renders it, Deactivate included. */
function renderRoster() {
  const deactivate = vi.fn();
  renderWithAuth(
    <>
      <EngineerRoster
        engineers={[SAM]}
        categories={undefined}
        renderActions={(engineer) => (
          <Button size="small" color="warning" onClick={() => deactivate(engineer.user_id)}>
            Deactivate
          </Button>
        )}
      />
      <LocationProbe />
    </>,
    { user: makeAdmin(), route: '/engineers' },
  );
  return { deactivate };
}

/** Where the router is now. */
function currentPath(): string {
  return screen.getByTestId('location').textContent ?? '';
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a roster row', () => {
  it('opens that engineer from a cell that is not the name link', async () => {
    renderRoster();

    // The email, deliberately: clicking the name would navigate through the
    // anchor and would prove nothing about the row.
    await userEvent.click(screen.getByText('sam.senior@acme.inc'));

    expect(currentPath()).toBe('/engineers/engineer-1');
  });

  it('keeps the name a real link, so the row is reachable without a pointer', () => {
    renderRoster();

    expect(screen.getByRole('link', { name: 'Sam Senior' })).toHaveAttribute(
      'href',
      '/engineers/engineer-1',
    );
  });

  it('lets Deactivate act without navigating', async () => {
    const { deactivate } = renderRoster();

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

    expect(deactivate).toHaveBeenCalledWith('engineer-1');
    expect(currentPath()).toBe('/engineers');
  });

  it('ignores the click that ends a drag across its text', async () => {
    renderRoster();
    // A selection the click is finishing, which is the state the rule exists
    // for: a reader highlighting an address should keep the page they are on.
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'sam.senior@acme.inc',
    } as Selection);

    await userEvent.click(screen.getByText('sam.senior@acme.inc'));

    expect(currentPath()).toBe('/engineers');
  });
});
