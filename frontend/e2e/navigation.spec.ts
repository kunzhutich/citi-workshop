import type { Page } from '@playwright/test';

import { expect, expectNothingLoading, test } from './fixtures/test';
import { reportIssue } from './fixtures/ticket';

/**
 * Getting back out of a ticket.
 *
 * The detail page's back link used to be a literal `<Button to="/tickets">All
 * tickets</Button>`, which produced two of the redesign brief's four bugs at
 * once: it named the wrong screen whatever you had come from, and it threw
 * away the query string that *is* a filtered list's state. Both are about the
 * same journey, so they are asserted together — on the round trip, which is
 * the only place either one is visible.
 *
 * Driven at both project widths. Below 900px the filter controls live in a
 * drawer behind one button, so "apply a filter" is a different sequence and
 * `applyStatusFilter` handles it; everything after that is identical, which is
 * the claim worth testing.
 */

/** Whether this project is the phone-sized one. */
function isMobile(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) < 900;
}

/**
 * Narrow the list by status, the way a person does.
 *
 * Not by navigating to `?status=…`: a test that types the URL would still
 * pass if the filter controls never wrote one, which is half of what this
 * file is about.
 */
async function applyStatusFilter(page: Page, status: string): Promise<void> {
  if (isMobile(page)) {
    await page.getByRole('button', { name: 'Search and filter' }).click();
    await expect(page.getByRole('button', { name: 'Show results' })).toBeVisible();
  }

  await page.getByLabel('Status').click();
  await page.getByRole('option', { name: status }).click();
  await page.keyboard.press('Escape');

  if (isMobile(page)) {
    await page.getByRole('button', { name: 'Show results' }).click();
  }

  await expect(page).toHaveURL(/status=/);
}

test.describe('the way back from a ticket', () => {
  test('names the list you came from and returns you to it, filters and all', async ({
    employeePage,
  }) => {
    const reference = await reportIssue(employeePage, {
      group: 'Hardware',
      subcategory: 'Laptop',
      title: 'The laptop fan runs flat out whenever it is docked',
      description: 'It is loud enough that people ask about it on calls, and only when docked.',
      priority: 'Low',
    });

    // --- From All tickets, filtered ------------------------------------------
    await employeePage.goto('/tickets');
    await expect(employeePage.getByText(reference).first()).toBeVisible();
    await applyStatusFilter(employeePage, 'Open');
    const filtered = employeePage.url();

    await employeePage.getByText(reference).first().click();
    await expect(employeePage.getByRole('heading', { level: 1 })).toBeVisible();

    // The link says where it goes. "All tickets" is also the fallback, so it
    // is asserted here *and* on the direct-link case below, where it is the
    // only thing that could be right.
    const back = employeePage.getByRole('link', { name: 'All tickets', exact: true });
    await expect(back).toBeVisible();
    await back.click();

    // The whole URL, not just the pathname: the filters are the query string,
    // and dropping them was the bug.
    await expect(employeePage).toHaveURL(filtered);
    await expectNothingLoading(employeePage);
    await expect(employeePage.getByText(reference).first()).toBeVisible();

    // --- From My tickets ------------------------------------------------------
    await employeePage.goto('/tickets/mine');
    await expect(employeePage.getByText(reference).first()).toBeVisible();
    await employeePage.getByText(reference).first().click();
    await expect(employeePage.getByRole('heading', { level: 1 })).toBeVisible();

    const backToMine = employeePage.getByRole('link', { name: 'My tickets', exact: true });
    await expect(backToMine).toBeVisible();
    await backToMine.click();
    await expect(employeePage).toHaveURL(/\/tickets\/mine$/);

    // --- And from a pasted link, where nothing said -----------------------------
    // A ticket opened directly carries no origin, so the link falls back to a
    // screen every role has. This is the case the old behaviour got right and
    // the one a fix could easily lose.
    const ticketUrl = await employeePage
      .getByText(reference)
      .first()
      .evaluate((node) => (node.closest('a') as HTMLAnchorElement | null)?.pathname ?? '');
    expect(ticketUrl).toMatch(/^\/tickets\/[0-9a-f-]+$/);

    await employeePage.goto(ticketUrl);
    await expect(employeePage.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(
      employeePage.getByRole('link', { name: 'All tickets', exact: true }),
    ).toBeVisible();
  });
});
