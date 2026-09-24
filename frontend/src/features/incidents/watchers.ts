import type { CategoryTree } from '../../api/types';
import { useCategoryTree } from '../categories/hooks';

/**
 * The one place the frontend asks whether a subcategory takes watchers.
 *
 * **Why a lookup rather than a field on the ticket.** "I'm affected too" only
 * makes sense for a problem other people share, and nothing already on a
 * ticket says whether this is one. `location_detail` is the field that looks
 * as though it should: it does not, and the two counter-examples are the point
 * of the rule. Software is BUILDING-level and an operating-system fault is one
 * person's alone; Hardware is FLOOR-level and a printer is shared while a
 * keyboard is not. Precision of location and sharedness of a problem are
 * simply different questions.
 *
 * So the backend carries a per-subcategory boolean an admin can edit, and this
 * module reads it. **There is no list of category names anywhere in this
 * codebase, and there must not be one** — the moment an admin adds "3D
 * printer" the list would be wrong, and nobody would know where to fix it.
 *
 * **This is for the screen that has no ticket yet.** The report questionnaire
 * knows only which subcategory has been chosen, so it has to look the flag up
 * in the category tree — reference data cached for an hour
 * (`features/categories/hooks.ts`), so the lookup costs a screen that has it
 * nothing. A screen that *does* hold a ticket reads
 * `incident.category.allows_watchers` instead, which the API sends on every
 * ticket: the tree excludes deactivated categories
 * (`repositories/categories.py::load_tree`), so a ticket filed against a
 * retired subcategory is not in it, and this function would answer "no
 * watchers" for a ticket somebody may already be watching.
 *
 * Two readers, then, and that is not two copies of the rule: both read the
 * same boolean the API computed, and neither derives it from anything. The
 * rule this module exists to protect is that **nothing in the frontend works
 * it out** — and the test fixture beside it points `location_detail` the
 * opposite way to the flags for exactly that reason.
 */

/**
 * Whether a subcategory allows watchers, given a loaded tree.
 *
 * Groups are not searched. A ticket is always filed against a subcategory, so
 * a group id here means the caller asked the wrong question and the honest
 * answer is no.
 *
 * Absent reads as `false`, which is the deploy-skew case described on
 * `Category.allows_watchers`: a bundle live for a few minutes against a Lambda
 * without the column hides the control rather than offering one the API would
 * refuse.
 */
export function allowsWatchers(
  tree: CategoryTree | undefined,
  categoryId: string | null,
): boolean {
  if (!categoryId) {
    return false;
  }

  for (const group of tree?.groups ?? []) {
    const subcategory = group.children.find((child) => child.id === categoryId);
    if (subcategory) {
      return subcategory.allows_watchers === true;
    }
  }
  return false;
}

/** The same answer, reading the tree from the cache. */
export function useAllowsWatchers(categoryId: string | null): boolean {
  const categories = useCategoryTree();
  return allowsWatchers(categories.data, categoryId);
}
