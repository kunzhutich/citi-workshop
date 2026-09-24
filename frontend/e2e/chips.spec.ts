import type { Page } from '@playwright/test';

import { expect, expectNothingLoading, test } from './fixtures/test';

/**
 * The chips are the same size as each other, and the arrows are gone.
 *
 * Section 3 of the redesign brief asks for one width per family of chip, more
 * padding inside them, no icons on the priority chip and a filled CRITICAL.
 * Every one of those is a geometry or a computed-style question, so none of it
 * can be asserted in jsdom — `src/components/UniformChip.tsx` pins widths that
 * were *measured* in a real browser, and a font change moves them.
 *
 * This is the test that would notice. Without it the widths are three numbers
 * in a comment, which is the arrangement S6's contrast figures were in when
 * three of them silently became wrong.
 */

/** Every chip on the page with this exact label, as rendered boxes. */
async function chipBoxes(page: Page, labels: string[]): Promise<Record<string, number>> {
  return page.evaluate((wanted) => {
    const widths: Record<string, number> = {};
    for (const chip of Array.from(document.querySelectorAll('.MuiChip-root'))) {
      const label = (chip.textContent ?? '').trim();
      if (wanted.includes(label) && widths[label] === undefined) {
        widths[label] = Math.round(chip.getBoundingClientRect().width * 10) / 10;
      }
    }
    return widths;
  }, labels);
}

test.describe('chips', () => {
  test('are one width per family, whatever the word', async ({ adminPage }) => {
    // Waited on a chip rather than on the table: below 900px the list is a
    // card list and there is no table, and the widths are the subject here, not
    // the layout that holds them.
    await adminPage.goto('/tickets');
    await expectNothingLoading(adminPage);
    await expect(adminPage.locator('.MuiChip-root').first()).toBeVisible();

    // Not every status is guaranteed to be on page one of a live list, so the
    // assertion is over whichever ones are there — with a floor, so that an
    // empty page cannot pass by having nothing to disagree about.
    const statuses = await chipBoxes(adminPage, [
      'Open',
      'In progress',
      'Blocked',
      'Resolved',
      'Closed',
    ]);
    const statusWidths = Object.values(statuses);
    expect(statusWidths.length, 'no status chips on the ticket list').toBeGreaterThanOrEqual(2);
    expect(new Set(statusWidths), `status chips differ: ${JSON.stringify(statuses)}`).toHaveProperty(
      'size',
      1,
    );
    expect(statusWidths[0]).toBe(92);

    const priorities = await chipBoxes(adminPage, ['Low', 'Medium', 'High', 'Critical']);
    const priorityWidths = Object.values(priorities);
    expect(priorityWidths.length, 'no priority chips on the ticket list').toBeGreaterThanOrEqual(2);
    expect(
      new Set(priorityWidths),
      `priority chips differ: ${JSON.stringify(priorities)}`,
    ).toHaveProperty('size', 1);
    expect(priorityWidths[0]).toBe(76);

    await adminPage.goto('/engineers');
    await expectNothingLoading(adminPage);
    const levels = await chipBoxes(adminPage, ['Junior', 'Senior', 'Lead']);
    const levelWidths = Object.values(levels);
    expect(levelWidths.length, 'no level chips on the engineers page').toBeGreaterThanOrEqual(2);
    expect(new Set(levelWidths), `level chips differ: ${JSON.stringify(levels)}`).toHaveProperty(
      'size',
      1,
    );
    expect(levelWidths[0]).toBe(64);
  });

  test('carry no icon on priority, and fill only CRITICAL', async ({ adminPage }) => {
    await adminPage.goto('/tickets?priority=CRITICAL');
    await expectNothingLoading(adminPage);

    const critical = adminPage.locator('.MuiChip-root').filter({ hasText: /^Critical$/ }).first();
    await expect(critical).toBeVisible();

    // The brief's reason for filling CRITICAL is that it should stand out from
    // the other three, so "filled" is asserted as *paint*, not as a class name
    // — a class could be present and overridden.
    const criticalFill = await critical.evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(criticalFill).toBe('rgb(199, 42, 42)');
    expect(await critical.locator('svg').count(), 'priority chips no longer carry an icon').toBe(0);

    await adminPage.goto('/tickets?priority=MEDIUM');
    await expectNothingLoading(adminPage);
    const medium = adminPage.locator('.MuiChip-root').filter({ hasText: /^Medium$/ }).first();
    await expect(medium).toBeVisible();

    // Outlined: a border, and a background that is not a block of colour.
    const outlined = await medium.evaluate((node) => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, borderWidth: style.borderTopWidth };
    });
    expect(outlined.background).toBe('rgba(0, 0, 0, 0)');
    expect(outlined.borderWidth).toBe('1px');
    expect(await medium.locator('svg').count()).toBe(0);
  });

  test('put the escalation flag before the title, so the flags line up', async ({ adminPage }) => {
    await adminPage.goto('/tickets?is_escalated=true');
    await expectNothingLoading(adminPage);

    const flags = adminPage.locator('.MuiChip-root').filter({ hasText: 'Escalated' });
    const count = await flags.count();
    expect(count, 'no escalated tickets to check').toBeGreaterThanOrEqual(2);

    // The point of moving it: every flag starts at the same x. Trailing the
    // title it sat wherever that row's sentence ended.
    const lefts = await flags.evaluateAll((nodes) =>
      nodes.map((node) => Math.round(node.getBoundingClientRect().left)),
    );
    expect(new Set(lefts), `flags are not aligned: ${lefts.join(', ')}`).toHaveProperty('size', 1);

    // And it really is before the title, not merely aligned with it. Asserted
    // on the flag's next sibling, which is the title in both layouts — a row
    // of a table on a desktop, a card on a phone — rather than on a `tr` that
    // only one of them has.
    const precedesTitle = await flags.evaluateAll((nodes) =>
      nodes.map((node) => {
        const next = node.nextElementSibling;
        if (!next) {
          return 'no sibling after the flag';
        }
        const flag = node.getBoundingClientRect();
        const title = next.getBoundingClientRect();
        return title.left > flag.left ? 'ok' : `flag at ${flag.left} is not before ${title.left}`;
      }),
    );
    expect(precedesTitle.filter((result) => result !== 'ok')).toEqual([]);
  });
});
