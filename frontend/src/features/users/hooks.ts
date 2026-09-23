import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '../../api/queryKeys';
import * as usersApi from '../../api/users';

/** One page of accounts, ordered by name. Admin only. */
export function useUsers(query: usersApi.UserQuery = {}) {
  return useQuery({
    queryKey: queryKeys.users.list(query),
    queryFn: () => usersApi.listUsers(query),
  });
}

/**
 * Change a user's role or active flag.
 *
 * Also invalidates the engineer roster: promoting someone to ENGINEER creates
 * a profile, and deactivating an engineer removes a row from the Team page and
 * the assign dialog.
 */
export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: usersApi.UserUpdatePayload }) =>
      usersApi.updateUser(id, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.engineers.all });
    },
  });
}
