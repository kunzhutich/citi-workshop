import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EscalatedTicket } from '../../api/reports';
import { makeAdmin, makeIncidentListItem } from '../../test/factories';
import { renderWithAuth } from '../../test/renderWithProviders';
import { setViewportWidth } from '../../test/viewport';

/**
 * A whole attention row that opens its ticket, with Assign still assigning.
 *
 * These are flex rows inside a card rather than `<table>` rows, so they take
 * the **stretched link** of D55 — one real anchor, the reference, grown over
 * the row by an absolutely positioned `::after`, with the row's actions lifted
 * above it — and not the click handler the ticket and engineer tables use.
 *
 * **jsdom cannot click "anywhere on the row".** There is no layout and no hit
 * testing, so a click on the title does not meet an overlay that has no
 * geometry. Clicking the middle of the row and watching it navigate is exactly
 * the assertion-adjacent-to-its-intent that D24, D25, D35 and D40 record, one
 * level worse: it would be unable to fail *and* unable to pass. So the three
 * pieces are asserted directly instead, which is what D55 says the arrangement
 * is worth — the overlay on the anchor, the box it is measured against, and
 * `zIndex: 1` on the actions, whose absence is the failure the whole pattern
 * exists to prevent and which a jsdom click would never notice.
 */

vi.mock('../../api/engineers', () => ({ listEngineers: vi.fn() }));
vi.mock('../../api/categories', () => ({ fetchCategoryTree: vi.fn() }));
vi.mock('../../api/incidents', () => ({ assignIncident: vi.fn() }));

const { listEngineers } = await import('../../api/engineers');
const { fetchCategoryTree } = await import('../../api/categories');
const { NeedsAttentionPanel } = await import('./NeedsAttentionPanel');

/** The moment the snapshot describes, so the ages below are exact. */
const AS_OF = '2026-09-23T09:00:00Z';

const ESCALATED: EscalatedTicket = {
  incident_id: 'incident-900',
  reference: 'INC-000900',
  title: 'Lift stuck between floors',
  status: 'IN_PROGRESS',
  priority: 'CRITICAL',
  escalation_reason: 'Nobody has been out to it',
  escalated_at: '2026-09-22T09:00:00Z',
  age_hours: 24,
};

/** Reported two days before the snapshot, so it clears the 24-hour cut. */
const UNASSIGNED = makeIncidentListItem({
  id: 'incident-901',
  reference: 'INC-000901',
  title: 'Tap running in the third-floor kitchen',
  created_at: '2026-09-21T09:00:00Z',
});

/** The router's current location, so a test can say where a click led. */
function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}</p>;
}

function renderPanel() {
  renderWithAuth(
    <>
      <NeedsAttentionPanel
        escalated={[ESCALATED]}
        escalatedTotal={1}
        unassigned={[UNASSIGNED]}
        isPending={false}
        error={null}
        asOf={AS_OF}
        buildingId=""
      />
      <LocationProbe />
    </>,
    { user: makeAdmin(), route: '/' },
  );
}

/** Where the router is now. */
function currentPath(): string {
  return screen.getByTestId('location').textContent ?? '';
}

/**
 * The `::after` rule Emotion wrote for this element, if it has one.
 *
 * jsdom implements `getComputedStyle` but refuses a pseudo-element argument,
 * and the pseudo-element *is* the mechanism — so the overlay has to be read
 * out of the stylesheet Emotion emitted rather than off the link.
 */
function overlayRule(element: Element): string | undefined {
  const rules = Array.from(document.querySelectorAll('style')).flatMap((tag) =>
    (tag.textContent ?? '').split('\n'),
  );
  return Array.from(element.classList)
    .filter((name) => name.startsWith('css-'))
    .map((name) => rules.find((rule) => rule.startsWith(`.${name}::after`)))
    .find((rule) => rule !== undefined);
}

/**
 * The box an overlay on `element` is measured against.
 *
 * The nearest positioned ancestor, which is what an absolutely positioned
 * `::after` stretches to fill. If the row stops being one, the overlay escapes
 * to whatever is positioned above it — or to nothing at all.
 */
function overlayContainer(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (getComputedStyle(node).position !== 'static') {
      return node;
    }
  }
  return null;
}

/** The Assign button on the first escalated row. */
function firstAssignButton(): HTMLElement {
  return screen.getAllByRole('button', { name: 'Assign' })[0];
}

beforeEach(() => {
  vi.mocked(listEngineers).mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
  vi.mocked(fetchCategoryTree).mockResolvedValue({ groups: [] });
});

describe('an attention row', () => {
  it.each([
    ['escalated', 'INC-000900', '/tickets/incident-900'],
    ['unassigned', 'INC-000901', '/tickets/incident-901'],
  ])('grows the %s row’s reference over the whole row', (_half, reference, href) => {
    renderPanel();

    const link = screen.getByRole('link', { name: reference });
    expect(link).toHaveAttribute('href', href);

    // The anchor carries the overlay … (said in words, so a missing rule
    // fails as a missing overlay rather than as an undefined argument)
    const overlay = overlayRule(link) ?? 'no ::after rule was emitted for the reference';
    expect(overlay).toContain('position:absolute');
    expect(overlay).toContain('inset:0');

    // … and the box it fills is the row, not the card or the panel: it reaches
    // from the reference across to that row's own Assign button.
    const row = overlayContainer(link);
    expect(row).not.toBeNull();
    expect(row).toContainElement(within(row as HTMLElement).getByRole('button', { name: 'Assign' }));
  });

  it('keeps Assign above the overlay, which is what keeps it clickable', () => {
    renderPanel();

    // Found without the overlay's help, so this fails for its own reason and
    // not because the row stopped being a positioning context.
    const assign = firstAssignButton();

    // Asserted rather than commented, per D55. A jsdom click would succeed
    // whatever the z-index says, because there is nothing to be covered by.
    expect(assign.parentElement).toHaveStyle({ position: 'relative', zIndex: '1' });
  });

  it('lets Assign open its dialog instead of opening the ticket', async () => {
    renderPanel();

    await userEvent.click(firstAssignButton());

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(currentPath()).toBe('/');
  });
});

/**
 * The one thing R7 changes about the button, and the width it does not change
 * it at.
 *
 * `RowActions` already gives every button in a row the full width of the row
 * below 900px, which is §4.5's answer to a 64px target at the hardest end of a
 * phone screen. Making the button bigger and centring it there would fight
 * that, so both are asked of `useBreakpoint` — the same question the rest of
 * the application asks — and neither reaches 375px.
 */
describe('the Assign button', () => {
  it('is medium and centred against the row on a desktop', () => {
    renderPanel();

    const assign = firstAssignButton();
    expect(assign.className).toContain('MuiButton-sizeMedium');
    expect(assign.parentElement).toHaveStyle({ alignSelf: 'center' });
  });

  it('is left exactly as it was on a phone', () => {
    setViewportWidth(375);
    renderPanel();

    const assign = firstAssignButton();
    expect(assign.className).toContain('MuiButton-sizeSmall');
    expect(assign.parentElement).not.toHaveStyle({ alignSelf: 'center' });
  });
});
