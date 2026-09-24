import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { DateRangeFields } from './DateRangeFields';
import { renderWithAuth } from '../test/renderWithProviders';
import { theme } from '../theme';

/**
 * Where a focused date picker draws its focus ring.
 *
 * The component's *value* contract — days in, days out, nothing written while a
 * date is half-typed — is tested through the two bars that use it, where the
 * URL it writes to is real. What is left over, and what this file is about, is
 * a claim `theme.ts` makes and cannot check for itself: that the selectors it
 * names land on the elements a picker actually renders.
 *
 * That is not hypothetical. The global ring is `body :focus-visible`, and a
 * picker's focusable elements are its day, month and year sections
 * *individually*, so the ring boxed whichever two characters the reader had
 * clicked — the fault D46 fixed on the app bar's search box, one level smaller.
 * A fix written as a selector is a fix that can miss: `@mui/x-date-pickers`
 * names these classes, and nothing in a type-check or a render would notice the
 * day Material UI renames one. Here, both halves of the rule are run against a
 * real picker rather than read back as strings.
 *
 * **jsdom renders the mobile picker** (D60): `matchMedia` cannot answer
 * `@media (pointer: fine)`, so `DatePicker` resolves to `MobileDatePicker`.
 * The field is the same component in both — the difference is a modal against a
 * popper — so the markup these selectors are matched against is the markup a
 * desktop browser has.
 */

/**
 * `CssBaseline`'s global rules, as the object Material UI hands to Emotion.
 *
 * Deliberately not shared with `theme.test.ts`'s copy: a helper in one test file
 * imported by another is a dependency between two suites, and this is four
 * lines. The two use it for different halves of the same claim — that file pins
 * the rules against each other, this one against the DOM.
 */
function baselineRules(): Record<string, unknown> {
  const overrides = theme.components?.MuiCssBaseline?.styleOverrides;
  if (typeof overrides !== 'function') {
    throw new Error('CssBaseline no longer states its rules as a function of the theme');
  }
  return overrides(theme) as Record<string, unknown>;
}

const rules = baselineRules();

/** The rule that puts the application's ring on everything else. */
const GLOBAL_RING = 'body :focus-visible';

/**
 * The picker's rule, found in the theme rather than written out again.
 *
 * Written out, this file would keep passing against a selector `theme.ts` no
 * longer contains, which is the one thing it exists to catch.
 */
function suppressionSelector(): string {
  const found = Object.keys(rules).find((selector) => selector.includes('Pickers'));
  if (found === undefined) {
    throw new Error('the theme has no rule for a picker section');
  }
  return found;
}

/** Everything the given selector matches, right now, anywhere on the page. */
function matches(selector: string): Element[] {
  return [...document.querySelectorAll(selector)];
}

/** One range, with a day in its first field so both are worth focusing. */
function renderFields(): void {
  renderWithAuth(
    <DateRangeFields from="2026-09-15" to="" onChange={() => {}} fromLabel="From" toLabel="To" />,
  );
}

describe('the focus ring on a date field', () => {
  it('is taken off the section the reader is standing on, and not put anywhere else', async () => {
    renderFields();
    const field = screen.getByRole('group', { name: 'From' });

    await userEvent.click(within(field).getByRole('spinbutton', { name: 'Day' }));

    // The positive first, and it is the premise of everything below: the thing
    // that takes focus inside a date field is one section, not the field. An
    // assertion about what the rule matches means nothing until this is true —
    // on a page where nothing is focused, it matches nothing and passes.
    const section = document.activeElement;
    expect(section).toHaveAttribute('role', 'spinbutton');
    expect(matches(GLOBAL_RING)).toEqual([section]);

    // So the suppression reaches exactly that element, and nothing in the theme
    // rings anything in its place.
    expect(matches(suppressionSelector())).toEqual([section]);
  });

  it('leaves the field showing focus the way every other field here does', async () => {
    renderFields();
    const field = screen.getByRole('group', { name: 'From' });

    await userEvent.click(within(field).getByRole('spinbutton', { name: 'Day' }));

    // **This is the other half of removing a focus ring**, and without it the
    // suppression above would be S6's defect rather than its fix. Measured on
    // the running app, a focused picker goes from a 1px notch to a 2px
    // `primary.main` one — which Material UI draws from `Mui-focused` on the
    // field root. jsdom cannot compute that border, but it can hold the class
    // the border is conditioned on, so this is the closest a unit test gets to
    // "a keyboard user can still see where they are".
    const root = field.closest('.MuiPickersInputBase-root');
    expect(root).toHaveClass('Mui-focused');

    // And unfocusing takes it away, so the assertion above is about focus
    // rather than about a class that is simply always there.
    await userEvent.tab();
    await userEvent.tab();
    expect(field.closest('.MuiPickersInputBase-root')).not.toHaveClass('Mui-focused');
  });

  it('leaves the calendar button the ring it already had', async () => {
    renderFields();
    const field = screen.getByRole('group', { name: 'From' });

    await userEvent.click(within(field).getByRole('spinbutton', { name: 'Day' }));
    // Tab rather than click: clicking the button opens the calendar and takes
    // focus into the dialog with it, so the field would be answering a question
    // nobody asked. Tab is also how a keyboard user reaches it.
    await userEvent.tab();

    const button = within(field).getByRole('button', { name: /Choose date/ });
    expect(document.activeElement).toBe(button);

    // Deleting a focus indicator is the thing S6 was written to stop, and the
    // suppression above is one word away from taking this one too.
    expect(matches(GLOBAL_RING)).toEqual([button]);
    expect(matches(suppressionSelector())).toEqual([]);
  });
});
