import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as categoriesApi from '../../api/categories';
import { queryKeys } from '../../api/queryKeys';
import type { CategoryNode, CategoryTree } from '../../api/types';

/**
 * Reading and maintaining the category tree.
 *
 * The tree is reference data: 37 rows that change when an admin edits them and
 * not otherwise. It is cached for an hour rather than the app-wide 30 seconds,
 * because the report questionnaire reads it on every visit and re-fetching a
 * near-static list on each one is a request that buys nothing.
 */

/** How long the tree is treated as fresh, in milliseconds. */
const TREE_STALE_TIME = 60 * 60_000;

/** Every group with its subcategories, in display order. */
export function useCategoryTree(includeInactive = false) {
  return useQuery({
    queryKey: queryKeys.categories.tree(includeInactive),
    queryFn: () => categoriesApi.fetchCategoryTree(includeInactive),
    staleTime: TREE_STALE_TIME,
  });
}

/** Find one group in a loaded tree. */
export function findGroup(tree: CategoryTree | undefined, groupId: string | null): CategoryNode | undefined {
  if (!groupId) {
    return undefined;
  }
  return tree?.groups.find((group) => group.id === groupId);
}

/** Find the group a subcategory belongs to, in a loaded tree. */
export function findGroupOfSubcategory(
  tree: CategoryTree | undefined,
  subcategoryId: string | null,
): CategoryNode | undefined {
  if (!subcategoryId) {
    return undefined;
  }
  return tree?.groups.find((group) =>
    group.children.some((child) => child.id === subcategoryId),
  );
}

/** Create a group or subcategory, then re-read the tree. */
export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: categoriesApi.createCategory,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.categories.all }),
  });
}

/** Update a category, then re-read the tree. */
export function useUpdateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: categoriesApi.CategoryUpdatePayload }) =>
      categoriesApi.updateCategory(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.categories.all }),
  });
}

/** Delete or deactivate a category, then re-read the tree. */
export function useDeleteCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: categoriesApi.deleteCategory,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.categories.all }),
  });
}
