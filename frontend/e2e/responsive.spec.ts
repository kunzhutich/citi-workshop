import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/test';
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
      // The bottom bar is the surface, and the permanent drawer is not
      // rendered at all — MUI keeps a temporary Drawer out of the DOM while
      // it is closed, which is what makes this assertion meaningful rather
      // than a check on visibility.
      await expect(employeePage.getByRole('button', { name: 'Open navigation' })).toBeVisible();
      await expect(employeePage.getByRole('link', { name: 'All tickets' })).toHaveCount(0);
      await expect(employeePage.getByRole('search')).toHaveCount(0);

      // Everything the drawer holds is one tap away, not hidden.
      await employeePage.getByRole('button', { name: 'Open navigation' }).click();
      await expect(employeePage.getByRole('link', { name: 'My tickets' })).toBeVisible();
    } else {
      await expect(employeePage.getByRole('link', { name: 'All tickets' })).toBeVisible();
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

    // Already on the detail page, having just reported it.
    expect(await horizontalOverflow(employeePage)).toBeLessThanOrEqual(1);

    await employeePage.goto('/report');
    await expect(employeePage.getByRole('button', { name: /^Hardware/ })).toBeVisible();
    expect(await horizontalOverflow(employeePage)).toBeLessThanOrEqual(1);

    await employeePage.goto('/tickets');
    await expect(employeePage.getByText(reference).first()).toBeVisible();
    expect(await horizontalOverflow(employeePage)).toBeLessThanOrEqual(1);
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

    const stepper = employeePage.getByRole('list', { name: 'Ticket progress' });
    const open = await stepper.getByText('Open', { exact: true }).boundingBox();
    const inProgress = await stepper.getByText('In progress', { exact: true }).boundingBox();
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
        'It is noticeably colder than the rest of the floor until about eleven, every day '
        + 'this week. People are working in coats.',
      priority: 'Medium',
    });

    const action = employeePage.getByRole('button', { name: 'Cancel ticket', exact: true });
    await expect(action).toBeInViewport();

    // Still in reach after scrolling past the whole page — which is the point
    // of a sticky bar, and the reason the detail page reserves height for it.
    await employeePage.mouse.wheel(0, 4000);
    await expect(action).toBeInViewport();

    // And it sits above the bottom navigation rather than over it. The bar's
    // items are buttons, not links: `AppShell` drives them through
    // `BottomNavigation`'s `onChange` and `navigate`, so there is no anchor.
    const actionBox = await action.boundingBox();
    const navBox = await employeePage.getByRole('button', { name: 'Home' }).first().boundingBox();
    expect(actionBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(navBox!.y + 1);
  });
});
