import { apiClient } from './client';
import type { Category, CategoryTree, DeleteResult, LocationDetail } from './types';

/**
 * The two-level category tree.
 *
 * A group is a category with no parent; a subcategory is one whose parent is a
 * group. There is no third level, and the API refuses to create one.
 */

/** Body of `POST /categories`. Omit `parent_id` to create a group. */
export interface CategoryCreatePayload {
  name: string;
  parent_id?: string | null;
  hint?: string | null;
  icon?: string | null;
  location_detail?: LocationDetail;
  sort_order?: number;
}

/**
 * Body of `PATCH /categories/{id}`.
 *
 * `parent_id` is deliberately absent: moving a subcategory between groups
 * would silently reclassify every incident already filed under it.
 */
export interface CategoryUpdatePayload {
  name?: string;
  hint?: string | null;
  icon?: string | null;
  location_detail?: LocationDetail;
  sort_order?: number;
  is_active?: boolean;
}

/**
 * Every group with its subcategories nested inside, in display order.
 *
 * One request rather than two: the questionnaire's first step renders the
 * groups and its second step renders `children`, and a user moves between them
 * in under a second.
 */
export async function fetchCategoryTree(includeInactive = false): Promise<CategoryTree> {
  const { data } = await apiClient.get<CategoryTree>('/categories', {
    params: includeInactive ? { include_inactive: true } : undefined,
  });
  return data;
}

/** Create a group or a subcategory. Admin only. */
export async function createCategory(payload: CategoryCreatePayload): Promise<Category> {
  const { data } = await apiClient.post<Category>('/categories', payload);
  return data;
}

/** Apply a partial update to a category. Admin only. */
export async function updateCategory(
  id: string,
  payload: CategoryUpdatePayload,
): Promise<Category> {
  const { data } = await apiClient.patch<Category>(`/categories/${id}`, payload);
  return data;
}

/** Delete a category, or deactivate it when incidents already reference it. */
export async function deleteCategory(id: string): Promise<DeleteResult> {
  const { data } = await apiClient.delete<DeleteResult>(`/categories/${id}`);
  return data;
}
