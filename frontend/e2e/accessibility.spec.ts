import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';

import { expect, expectNothingLoading, test } from './fixtures/test';
import { reportIssue } from './fixtures/ticket';

/**
 * Accessibility, checked two ways, because one of them is not enough.
 *
 * **axe-core** finds what a machine can decide: a control with no accessible
 * name, text that fails a contrast ratio, a heading level skipped, a landmark
 * missing, an `aria-*` attribute on an element that cannot carry it. It runs
 * here against every screen in the application, at both widths, and — the part
 * that matters — with the dialogs and the mobile drawer *open*, because the
 * markup a screen shows at rest is not the markup a person interacts with.
 *
 * **Keyboard tests** find what a machine cannot: whether the focus ring is
 * where the user is, whether Escape closes the thing they opened, whether
 * focus goes back to the control they opened it from, whether a screen can be
 * operated at all without a pointer. A page can pass axe with no keyboard
 * path to half its features — the bars of a chart, for instance, which are
 * SVG rectangles with click handlers and no `tabindex`. axe cannot see that
 * anything is missing, because nothing there is wrong; the thing that is wrong
 * is an absence.
 *
 * WCAG 2.1 AA is the bar, expressed as the four tag filters below. `best-
 * practice` rules are deliberately **not** enabled: they include opinions
 * (landmark-unique, region) that are worth arguing about rather than failing a
 * build over, and mixing them in would make a real violation harder to see.
 */

/** The rule sets a violation has to belong to for this suite to fail on it. */
const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Whether this project is the phone-sized one. */
function isMobile(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) < 900;
}

/**
 * Run axe over the page, or over one part of it, and return the violations.
 *
 * Scoped with `include` for a dialog, so that a failure elsewhere on the page
 * does not get reported against the dialog's test and send the next reader to
 * the wrong file.
 */
async function analyse(page: Page, include?: string) {
  let builder = new AxeBuilder({ page }).withTags(WCAG_AA);
  if (include) {
    builder = builder.include(include);
  }
  return builder.analyze();
}

/** A violation rendered as something a person can act on. */
function describeViolations(results: {
  violations: Awaited<ReturnType<typeof analyse>>['violations'];
}) {
  return results.violations
    .map((violation) => {
      const where = violation.nodes
        .slice(0, 4)
        .map((node) => `      ${node.target.join(' ')}\n        ${node.failureSummary}`)
        .join('\n');
      return `  [${violation.impact}] ${violation.id}: ${violation.help}\n${where}`;
    })
    .join('\n');
}

/**
 * Assert a page, or part of one, has no WCAG AA violations.
 *
 * Compared as a *string*, not as an array of objects. An object diff of an
 * axe result is several hundred lines of `helpUrl` and `relatedNodes` per
 * violation, and the one line naming the rule is somewhere in the middle of
 * it. A failure here prints the rule, its impact, and the selectors — which is
 * what the person fixing it needs, and all of it.
 */
async function expectNoViolations(page: Page, include?: string) {
  const results = await analyse(page, include);
  expect(describeViolations(results), 'axe found WCAG 2.1 AA violations').toBe('');
}

test.describe('axe: every screen', () => {
  test('the sign-in screen', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    await expectNoViolations(page);
  });

  test('the sign-in screen showing an error', async ({ page }) => {
    // An error state is a different page as far as contrast and naming go,
    // and it is the state a user in trouble is actually looking at.
    await page.goto('/login');
    await page.getByLabel('Email').fill('nobody.at.all@acme.inc');
    await page.getByLabel('Password').fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toBeVisible();

    await expectNoViolations(page);
  });

  test('the registration screen', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: /Create/ })).toBeVisible();

    await expectNoViolations(page);
  });

  test('the employee home screen', async ({ employeePage }) => {
    await employeePage.goto('/');
    await expect(employeePage.getByRole('heading', { level: 1 })).toBeVisible();
    // The greeting is outside every `QueryState`, so it is on screen while the
    // four tiles and the recent-ticket list are still spinners. Scanning then
    // would scan the spinners rather than the screen this test names.
    await expectNothingLoading(employeePage);

    await expectNoViolations(employeePage);
  });

  test('the report questionnaire, at every stage it reveals', async ({ employeePage }) => {
    await employeePage.goto('/report');
    await expect(employeePage.getByRole('button', { name: /^Hardware/ })).toBeVisible();
    await expectNoViolations(employeePage);

    // Each answer reveals another section, and a revealed section is markup
    // the first scan never saw.
    await employeePage.getByRole('button', { name: /^Hardware/ }).click();
    await employeePage.getByRole('button', { name: 'Keyboard/Mouse' }).click();
    await expect(employeePage.getByLabel(/^Building/)).toBeVisible();
    await expectNoViolations(employeePage);
  });

  test('the ticket list', async ({ employeePage }) => {
    await employeePage.goto('/tickets');
    await expect(employeePage.getByRole('heading', { level: 1 })).toBeVisible();
    // `PageHeader` sits outside the `QueryState` that holds the list itself.
    await expectNothingLoading(employeePage);

    await expectNoViolations(employeePage);
  });

  test('a ticket detail page', async ({ employeePage }) => {
    await reportIssue(employeePage, {
      group: 'Hardware',
      subcategory: 'Monitor',
      title: 'The second monitor flickers every few minutes',
      description: 'It blanks for about a second and comes back, several times an hour.',
      priority: 'Medium',
    });
    await expect(employeePage.getByRole('list', { name: 'Ticket progress' })).toBeVisible();

    await expectNoViolations(employeePage);
  });

  test('the admin dashboard, charts and all', async ({ adminPage }) => {
    await adminPage.goto('/');
    await expect(adminPage.getByRole('heading', { level: 1 })).toBeVisible();
    // The charts are lazy-loaded; scanning before they arrive scans a spinner.
    // The heading below only proves the chunk mounted: `/Reported/` matches
    // "Reported in this period", which `PeriodScopeHeading` renders outside
    // every `QueryState` and with a literal fallback for its dates. The wait
    // that actually keeps the charts in the scan is the one after it. See D24.
    await expect(adminPage.getByRole('heading', { name: /Reported/ }).first()).toBeVisible();
    await expectNothingLoading(adminPage);

    await expectNoViolations(adminPage);
  });

  /*
   * The four admin screens. Added after the `list` violation the ticket screens
   * turned up was found by inspection on three more screens that nothing was
   * scanning — a rule this suite does not exercise is a rule this suite does
   * not enforce, and the facilities tree had the worst of it.
   */
  for (const [name, path, heading] of [
    ['facilities', '/facilities', 'Facilities'],
    ['engineers', '/engineers', 'Engineers'],
    ['categories', '/categories', 'Categories'],
    ['users', '/users', 'Users'],
  ]) {
    test(`the ${name} screen`, async ({ adminPage }) => {
      await adminPage.goto(path);
      await expect(adminPage.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      // The heading is `PageHeader`, mounted outside the `QueryState` holding
      // the tree or table these tests exist to scan — the facilities tree
      // above all, which §1 records as having had the worst of it.
      await expectNothingLoading(adminPage);

      await expectNoViolations(adminPage);
    });
  }

  test('the page that is not there', async ({ employeePage }) => {
    await employeePage.goto('/this-is-not-a-page');
    await expect(employeePage.getByRole('heading', { name: 'Page not found' })).toBeVisible();

    await expectNoViolations(employeePage);
  });
});

test.describe('axe: the states a resting page does not show', () => {
  test('a workflow dialog while it is open', async ({ employeePage }) => {
    await reportIssue(employeePage, {
      group: 'Network & Access',
      subcategory: 'Wi-Fi',
      title: 'Wi-Fi drops whenever I walk to the north side',
      description: 'It reconnects after half a minute, but any call I am on ends first.',
      priority: 'Medium',
    });

    await employeePage.getByRole('button', { name: 'Escalate', exact: true }).first().click();
    const dialog = employeePage.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await expectNoViolations(employeePage, '[role="dialog"]');
  });

  test('the assign dialog, which is a list of people', async ({ adminPage }) => {
    // The one list in the app whose rows carry their own sub-widgets, and the
    // third place the `<ul>` held something that is not an `<li>`.
    await adminPage.goto('/tickets');
    await adminPage.getByRole('link', { name: /INC-/ }).first().click();
    await adminPage.waitForURL(/\/tickets\/[0-9a-f-]{36}$/);

    const assign = adminPage.getByRole('button', { name: /^(Assign|Reassign)/ }).first();
    await expect(assign).toBeVisible();
    await assign.click();
    await expect(adminPage.getByRole('dialog')).toBeVisible();

    await expectNoViolations(adminPage, '[role="dialog"]');
  });

  test('the mobile navigation drawer while it is open', async ({ employeePage }) => {
    test.skip(!isMobile(employeePage), 'the drawer is the phone navigation');

    await employeePage.goto('/tickets');
    // The scan below is of the whole page, not just the drawer, so the list
    // behind it has to have arrived too.
    await expectNothingLoading(employeePage);
    await employeePage.getByRole('button', { name: 'Open navigation' }).click();
    await expect(employeePage.getByRole('navigation', { name: 'Main' })).toBeVisible();

    await expectNoViolations(employeePage);
  });

  test('the mobile filter drawer while it is open', async ({ employeePage }) => {
    test.skip(!isMobile(employeePage), 'the filter sheet is the phone layout');

    await employeePage.goto('/tickets');
    await expectNothingLoading(employeePage);
    await employeePage
      .getByRole('button', { name: /Filter/i })
      .first()
      .click();
    // The sheet's own button, so this is an open drawer rather than one still
    // sliding up. Nothing else waited for the drawer at all.
    await expect(employeePage.getByRole('button', { name: 'Show results' })).toBeVisible();

    await expectNoViolations(employeePage);
  });
});

test.describe('what a screen reader is given instead of a picture', () => {
  test('the workflow stepper says which step the ticket is on, in words', async ({
    employeePage,
  }) => {
    await reportIssue(employeePage, {
      group: 'Hardware',
      subcategory: 'Docking Station',
      title: 'The dock drops the second monitor when I unplug the laptop',
      description: 'Plugging back in brings up one screen; the second needs a reboot.',
      priority: 'Low',
    });

    const stepper = employeePage.getByRole('list', { name: 'Ticket progress' });

    // Material UI draws done / here / not-yet as a tick, a filled circle and a
    // grey circle. None of that is available to a screen reader, so each step
    // carries its state as words.
    await expect(stepper.getByText(/^Open, current step/)).toBeAttached();
    await expect(stepper.getByText(/^In progress, not started/)).toBeAttached();
    await expect(stepper.getByText(/^Resolved, not started/)).toBeAttached();
  });

  test('every chart has a text alternative, and one of them is a table', async ({ adminPage }) => {
    await adminPage.goto('/');
    // This heading is not evidence that the charts exist. `/Reported/` matches
    // "Reported in this period" — `PeriodScopeHeading`, mounted outside every
    // `QueryState` and earlier in the DOM than the flow chart's own heading —
    // so it is on screen before any of the dashboard's report requests has
    // returned.
    // Every `role="img"` in the application is inside a chart, and every chart
    // is behind a `QueryState`. See D24.
    await expect(adminPage.getByRole('heading', { name: /Reported/ }).first()).toBeVisible();
    await expectNothingLoading(adminPage);

    // Each chart is one labelled image rather than a few hundred unlabelled
    // SVG nodes. `role="img"` also makes the subtree presentational, so the
    // axis ticks are not read out in emission order.
    const charts = adminPage.getByRole('img');
    await expect(charts, 'the dashboard should have drawn its charts').not.toHaveCount(0);
    for (const chart of await charts.all()) {
      const label = await chart.getAttribute('aria-label');
      expect(label, 'a chart must describe itself').toBeTruthy();
      expect(label).toMatch(/chart/i);
    }

    // And the flow chart's numbers are reachable without a hover. It was the
    // one chart on this dashboard with no table twin, which made the claim
    // that every value is reachable false for the chart with the most values.
    const flow = adminPage
      .getByRole('group', { name: 'How to show reported and closed by day' })
      .getByRole('button', { name: 'Show as a table' });
    await expect(flow).toBeVisible();
    await flow.click();
    await expect(
      adminPage.getByRole('table', { name: 'Reported and closed by day, as a table' }),
    ).toBeVisible();
  });
});

test.describe('the keyboard', () => {
  /** The element that currently has focus, as a readable description. */
  async function focused(page: Page): Promise<string> {
    return page.evaluate(() => {
      const element = document.activeElement;
      if (!element) {
        return 'nothing';
      }
      const label =
        element.getAttribute('aria-label') ?? (element.textContent ?? '').trim().slice(0, 40) ?? '';
      return `${element.tagName.toLowerCase()}:${label}`;
    });
  }

  /** Press Tab until `target` has focus, or fail saying where we ended up. */
  async function tabTo(page: Page, target: Locator, limit = 40): Promise<number> {
    for (let presses = 1; presses <= limit; presses += 1) {
      await page.keyboard.press('Tab');
      if (await target.evaluate((node) => node === document.activeElement)) {
        return presses;
      }
    }
    throw new Error(
      `never reached the target in ${limit} presses of Tab; focus ended on ${await focused(page)}`,
    );
  }

  test('the skip link is the first stop and lands on the main content', async ({
    employeePage,
  }) => {
    await employeePage.goto('/tickets');
    // Deliberately no click first. Clicking a non-focusable element sets the
    // browser's *sequential focus navigation starting point* to it, so Tab
    // resumes from there rather than from the top of the document — which
    // skips right over the skip link and makes this test fail against an
    // application that is working. A freshly loaded page has no starting
    // point, so Tab begins where a real user's first Tab begins.
    //
    // Waiting for the shell first is also load-bearing. `goto` resolves while
    // the app is still showing "Restoring your session…", which has no
    // focusable element at all — tabbing then does nothing, and the assertion
    // below would measure the wrong page.
    await expect(employeePage.getByRole('heading', { level: 1 })).toBeVisible();

    const skip = employeePage.getByRole('link', { name: 'Skip to main content' });
    expect(await tabTo(employeePage, skip, 3)).toBe(1);
    // Hidden until focused, and visible the moment it is — a skip link that
    // stays off screen while focused tells a sighted keyboard user nothing.
    await expect(skip).toBeInViewport();

    await employeePage.keyboard.press('Enter');
    const landed = await employeePage.evaluate(() => document.activeElement?.id);
    expect(landed).toBe('main-content');
  });

  test('the report questionnaire can be completed without a pointer', async ({ employeePage }) => {
    await employeePage.goto('/report');
    const hardware = employeePage.getByRole('button', { name: /^Hardware/ });
    await expect(hardware).toBeVisible();

    // Reachable by Tab, and operable by Space — the two halves of "this is a
    // real button", and the pair a clickable `<div>` fails.
    await tabTo(employeePage, hardware);
    await employeePage.keyboard.press('Space');

    const subcategory = employeePage.getByRole('button', { name: 'Keyboard/Mouse' });
    await expect(subcategory).toBeVisible();
    await tabTo(employeePage, subcategory);
    await employeePage.keyboard.press('Enter');

    await expect(employeePage.getByLabel(/^Building/)).toBeVisible();
  });

  test('a card that is selected says so, rather than only looking so', async ({ employeePage }) => {
    await employeePage.goto('/report');
    const hardware = employeePage.getByRole('button', { name: /^Hardware/ });

    await expect(hardware).toHaveAttribute('aria-pressed', 'false');
    await hardware.click();
    await expect(hardware).toHaveAttribute('aria-pressed', 'true');
  });

  test('a dialog takes focus, returns it, and closes on Escape', async ({ employeePage }) => {
    await reportIssue(employeePage, {
      group: 'Building & Facilities',
      subcategory: 'Lighting',
      title: 'The light above the north stairwell is out',
      description: 'It has been dark for three days and the stairs are hard to see.',
      priority: 'Low',
    });

    const opener = employeePage.getByRole('button', { name: 'Escalate', exact: true }).first();
    await opener.click();

    const dialog = employeePage.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Focus must be inside the dialog, or the next Tab is somewhere behind it.
    const focusInside = await employeePage.evaluate(() => {
      const active = document.activeElement;
      const open = document.querySelector('[role="dialog"]');
      return Boolean(active && open && open.contains(active));
    });
    expect(focusInside, 'focus should move into the dialog when it opens').toBe(true);

    await employeePage.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // And back where it came from, or the user is dropped at the top of the
    // document and has to tab all the way down again.
    await expect(opener).toBeFocused();
  });

  test('the mobile drawer returns focus to the button that opened it', async ({ employeePage }) => {
    test.skip(!isMobile(employeePage), 'the drawer is the phone navigation');

    await employeePage.goto('/tickets');
    const opener = employeePage.getByRole('button', { name: 'Open navigation' });
    await opener.click();
    await expect(employeePage.getByRole('navigation', { name: 'Main' })).toBeVisible();

    await employeePage.keyboard.press('Escape');

    await expect(employeePage.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('every workflow action on a ticket is reachable by keyboard', async ({ employeePage }) => {
    await reportIssue(employeePage, {
      group: 'Software',
      subcategory: 'Email/Calendar',
      title: 'Calendar invitations arrive as raw attachments',
      description: 'Invites turn up as .ics files rather than something I can accept.',
      priority: 'Low',
    });

    // The two an employee always has on their own open ticket.
    for (const name of ['Escalate', 'Cancel ticket']) {
      const action = employeePage.getByRole('button', { name, exact: true }).first();
      await expect(action).toBeVisible();
      await action.focus();
      await expect(action).toBeFocused();
    }
  });
});
