import type { Page } from '@playwright/test';

import { expect, expectNothingLoading, test } from './fixtures/test';
import { reportIssue } from './fixtures/ticket';

/**
 * The things a browser can check and jsdom cannot.
 *
 * jsdom has no layout engine. Every box it reports is zero by zero, so the
 * Vitest suite can prove that `useBreakpoint` *decides* "mobile" below 900px —
 * it stubs `matchMedia` to say so — but not that anything is actually laid
 * out at 375px, because nothing is laid out at all.
 *
 * These are therefore assertions about geometry: which navigation surface is
 * on screen, whether a page scrolls sideways, whether a dialog fills a phone,
 * whether the stepper runs across or down, and whether the sticky action bar
 * is still reachable at the bottom of a long ticket.
 */

/** Whether this project is the phone-sized one. */
function isMobile(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) < 900;
}

/** How many pixels the document scrolls sideways. Should be none. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe('layout', () => {
  test('the shell shows the navigation surface that fits the width', async ({ employeePage }) => {
    await employeePage.goto('/tickets');

    if (isMobile(employeePage)) {
      // Asserted on the landmarks rather than on individual links, because
      // both surfaces hold some of the same labels: "Quick links" is the
      // four-item bottom bar, "Main" is the full list in the drawer. The
      // drawer's absence is meaningful rather than a visibility check — MUI
      // keeps a temporary Drawer out of the DOM entirely while it is closed.
      await expect(employeePage.getByRole('navigation', { name: 'Quick links' })).toBeVisible();
      await expect(employeePage.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
      await expect(employeePage.getByRole('button', { name: 'Open navigation' })).toBeVisible();
      await expect(employeePage.getByRole('search')).toHaveCount(0);

      // Everything the drawer holds is one tap away, not hidden.
      await employeePage.getByRole('button', { name: 'Open navigation' }).click();
      const drawer = employeePage.getByRole('navigation', { name: 'Main' });
      await expect(drawer.getByRole('link', { name: 'My tickets' })).toBeVisible();
    } else {
      await expect(employeePage.getByRole('navigation', { name: 'Main' })).toBeVisible();
      await expect(employeePage.getByRole('link', { name: 'All tickets' })).toBeVisible();
      await expect(employeePage.getByRole('navigation', { name: 'Quick links' })).toHaveCount(0);
      await expect(employeePage.getByRole('button', { name: 'Open navigation' })).toHaveCount(0);
      await expect(employeePage.getByRole('search')).toBeVisible();
    }
  });

  test('no screen scrolls sideways', async ({ employeePage }) => {
    // The three screens with the most across them: a five-column card grid,
    // an eight-column table, and a two-column detail page.
    const reference = await reportIssue(employeePage, {
      group: 'Hardware',
      subcategory: 'Keyboard/Mouse',
      title: 'Spacebar sticks on the left-hand side',
      description: 'It needs a firm press about one time in five, which is slowing typing down.',
      priority: 'Low',
    });
    expect(reference).toMatch(/^INC-\d+$/);

    // Already on the detail page, having just reported it. Measured only once
    // the page has finished arriving: "does not scroll sideways" is an absence,
    // and a screen whose two-column grid is still a pair of spinners is narrow
    // enough to satisfy it whatever the laid-out page would do. The other two
    // measurements below are each preceded by a wait for the widest thing on
    // that screen — the category grid, and a row of the eight-column table —
    // so they already stand on a rendered page. See D25.
    await expectNothingLoading(employeePage);
    expect(await horizontalOverflow(employeePage)).toBeLessThanOrEqual(1);

    await employeePage.goto('/report');
    await expect(employeePage.getByRole('button', { name: /^Hardware/ })).toBeVisible();
    expect(await horizontalOverflow(employeePage)).toBeLessThanOrEqual(1);

    await employeePage.goto('/tickets');
    await expect(employeePage.getByText(reference).first()).toBeVisible();
    expect(await horizontalOverflow(employeePage)).toBeLessThanOrEqual(1);
  });

  test('the ticket list does not scroll sideways at any width', async ({ employeePage }) => {
    // Fifteen full page loads, so the file's 90-second default is not enough.
    // `slow()` triples it rather than naming a number, which is the right
    // shape: the budget should follow the machine, not a guess made on one.
    test.slow();

    // The test above measures at this project's viewport, and this file has
    // two of them: 375 and 1440. That is what let a real overflow ship.
    //
    // The list screen's filter bar used to lay itself out behind Material
    // UI's `md` breakpoint, which asks how wide the *window* is — while the
    // bar sits inside `<main>`, 248px of permanent drawer and 48px of padding
    // narrower than that. Between roughly 900px and 1300px the six columns
    // switched on into a box that could not hold them, and the document
    // scrolled sideways by up to 333px. Neither 375 nor 1440 is in that band,
    // so every assertion in this file passed while every list screen in the
    // application was broken for anyone on a laptop.
    //
    // The lesson is not "add 1024 to the list". It is that a layout rule with
    // a threshold in it has to be measured on both sides of the threshold and
    // in between, so this sweeps rather than samples. The widths below step
    // through both switches the shell has: the 900px navigation change, and
    // every point at which the bar gains or loses a column.
    const widths = [360, 400, 480, 600, 768, 840, 900, 960, 1024, 1100, 1200, 1280, 1366, 1440, 1600];

    const reference = await reportIssue(employeePage, {
      group: 'Hardware',
      subcategory: 'Monitor',
      title: 'The second monitor wakes up black every morning',
      description: 'Unplugging the cable and plugging it back in fixes it until the next day.',
      priority: 'Low',
    });

    for (const width of widths) {
      await employeePage.setViewportSize({ width, height: 900 });
      await employeePage.goto('/tickets');
      // A rendered row rather than a heading: the filter bar and the table
      // are the wide things, and a screen still fetching is narrow enough to
      // satisfy any assertion about width. See D25.
      await expect(employeePage.getByText(reference).first()).toBeVisible();
      await expectNothingLoading(employeePage);

      expect(await horizontalOverflow(employeePage), `at ${width}px`).toBeLessThanOrEqual(1);

      // Below 900px the filter controls are not on the page at all — they are
      // in a drawer behind one button — so measuring the list alone would be
      // measuring the wrong thing. A negative assertion has to earn its
      // emptiness.
      if (width < 900) {
        await employeePage.getByRole('button', { name: 'Search and filter' }).click();
        await expect(employeePage.getByRole('button', { name: 'Show results' })).toBeVisible();
        expect(
          await horizontalOverflow(employeePage),
          `with the filter drawer open at ${width}px`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  test('the workflow stepper runs across on desktop and down on a phone', async ({
    employeePage,
  }) => {
    await reportIssue(employeePage, {
      group: 'Software',
      subcategory: 'Email/Calendar',
      title: 'Calendar invitations arrive as attachments',
      description: 'Invites show up as .ics files rather than something I can accept.',
      priority: 'Low',
    });

    // Matched as a prefix, not exactly. As of S6 each step's label carries its
    // state as visually hidden words — "Open, current step", "In progress, not
    // started" — because Material UI draws done/here/not-yet as a tick, a
    // filled circle and a grey one, which is shape and colour and nothing a
    // screen reader can use. The step number is rendered inside the icon, so
    // the surrounding list item's text begins "1Open…" and does not match.
    const stepper = employeePage.getByRole('list', { name: 'Ticket progress' });
    const open = await stepper.getByText(/^Open\b/).boundingBox();
    const inProgress = await stepper.getByText(/^In progress\b/).boundingBox();
    expect(open).not.toBeNull();
    expect(inProgress).not.toBeNull();

    // Compared on centres, not edges. With `alternativeLabel` each step's
    // label spans its whole column, so the two boxes abut exactly — the first
    // version of this asserted `inProgress.x > open.x + open.width` and failed
    // on 566.5 > 566.5.
    const centre = (box: { x: number; y: number; width: number; height: number }) => ({
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    });
    const first = centre(open!);
    const second = centre(inProgress!);

    if (isMobile(employeePage)) {
      // Stacked: below, and in the same column.
      expect(second.y).toBeGreaterThan(first.y);
      expect(Math.abs(second.x - first.x)).toBeLessThan(40);
    } else {
      // Side by side: to the right, and on the same line.
      expect(second.x).toBeGreaterThan(first.x);
      expect(Math.abs(second.y - first.y)).toBeLessThan(10);
    }
  });

  test('a dialog fills a phone and is a panel on a desktop', async ({ employeePage }) => {
    await reportIssue(employeePage, {
      group: 'Network & Access',
      subcategory: 'Wi-Fi',
      title: 'Wi-Fi drops every time I walk to the kitchen',
      description: 'It reconnects after about thirty seconds, but any call I am on ends.',
      priority: 'Medium',
    });

    await employeePage.getByRole('button', { name: 'Escalate', exact: true }).first().click();
    const dialog = employeePage.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const box = await dialog.boundingBox();
    const viewport = employeePage.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();

    if (isMobile(employeePage)) {
      // Full screen, because a centred dialog with a text field in it is
      // unusable once the on-screen keyboard takes half the viewport.
      expect(box!.width).toBeGreaterThanOrEqual(viewport!.width - 1);
      expect(box!.height).toBeGreaterThanOrEqual(viewport!.height - 1);
    } else {
      expect(box!.width).toBeLessThan(viewport!.width);
    }
  });

  test('the phone keeps the ticket actions in reach', async ({ employeePage }) => {
    test.skip(!isMobile(employeePage), 'the sticky action bar is the phone layout');

    await reportIssue(employeePage, {
      group: 'Building & Facilities',
      subcategory: 'Temperature/HVAC',
      title: 'The east side of the floor is freezing all morning',
      description:
        'It is noticeably colder than the rest of the floor until about eleven, every day ' +
        'this week. People are working in coats.',
      priority: 'Medium',
    });

    const action = employeePage.getByRole('button', { name: 'Cancel ticket', exact: true });
    await expect(action).toBeInViewport();

    // Still in reach after scrolling past the whole page — which is the point
    // of a sticky bar, and the reason the detail page reserves height for it.
    await employeePage.mouse.wheel(0, 4000);
    await expect(action).toBeInViewport();

    // And it sits above the bottom navigation rather than over it. The bar's
    // items are anchors as of S6 — they go somewhere, so they are links, and
    // a screen reader now says so.
    const actionBox = await action.boundingBox();
    const navBox = await employeePage
      .getByRole('navigation', { name: 'Quick links' })
      .getByRole('link', { name: 'Home' })
      .first()
      .boundingBox();
    expect(actionBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(navBox!.y + 1);
  });
});
