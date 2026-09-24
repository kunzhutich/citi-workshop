import { describe, expect, it } from 'vitest';

import type { Category, CategoryTree } from '../../api/types';
import { allowsWatchers } from './watchers';

/**
 * The one rule this module exists for: **the flag is read, never derived.**
 *
 * The temptation it guards against is a plausible one — Software is
 * BUILDING-level and Hardware is FLOOR-level, so `location_detail` looks like
 * a free answer to "does this affect other people?". It is not: an
 * operating-system fault is one person's under a BUILDING-level group, and a
 * printer is shared under a FLOOR-level one. The fixtures below are exactly
 * that pair, so a future implementation that reached for `location_detail`
 * would fail here rather than in front of a user.
 */

function category(id: string, overrides: Partial<Category> = {}): Category {
  return {
    id,
    parent_id: 'g',
    name: id,
    hint: null,
    icon: null,
    location_detail: 'FLOOR',
    sort_order: 0,
    is_active: true,
    // The base is the conservative answer; every test that is about this
    // flag overrides it explicitly, which is what makes those tests readable.
    allows_watchers: false,
    ...overrides,
  };
}

/**
 * Two groups whose `location_detail` points the opposite way to their flags.
 *
 * Software is BUILDING-level and does *not* take watchers; Hardware is
 * FLOOR-level and does. Anything that guessed from the location precision
 * would get both answers backwards.
 */
const TREE: CategoryTree = {
  groups: [
    {
      ...category('g-software', { parent_id: null, location_detail: 'BUILDING' }),
      children: [
        category('c-os', { location_detail: 'BUILDING', allows_watchers: false }),
        category('c-email', { location_detail: 'BUILDING', allows_watchers: true }),
      ],
    },
    {
      ...category('g-hardware', { parent_id: null }),
      children: [
        category('c-printer', { allows_watchers: true }),
        category('c-keyboard', { allows_watchers: false }),
      ],
    },
  ],
};

describe('allowsWatchers', () => {
  it.each([
    ['c-printer', true],
    ['c-keyboard', false],
    ['c-email', true],
    ['c-os', false],
  ])('answers %s with what the flag says, not what its group implies', (id, expected) => {
    expect(allowsWatchers(TREE, id)).toBe(expected);
  });

  it('says no for a group id, because a ticket is never filed against one', () => {
    // Both halves: the tree provably contains this id, so the `false` is the
    // rule answering and not the lookup missing the tree entirely.
    expect(TREE.groups.some((group) => group.id === 'g-hardware')).toBe(true);
    expect(allowsWatchers(TREE, 'g-hardware')).toBe(false);
  });

  it('says no for a subcategory the API has not given the field to', () => {
    // The deploy-skew case: a bundle live against a Lambda whose CategoryRead
    // predates the column hides the control rather than offering one the API
    // would refuse.
    const older: CategoryTree = {
      groups: [{ ...category('g', { parent_id: null }), children: [category('c-unknown')] }],
    };

    expect(allowsWatchers(older, 'c-unknown')).toBe(false);
  });

  it('says no when there is nothing to look in, or nothing to look for', () => {
    expect(allowsWatchers(undefined, 'c-printer')).toBe(false);
    expect(allowsWatchers(TREE, null)).toBe(false);
    expect(allowsWatchers(TREE, 'c-nonexistent')).toBe(false);
  });
});
