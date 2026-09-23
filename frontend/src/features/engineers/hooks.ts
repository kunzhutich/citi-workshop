import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as engineersApi from '../../api/engineers';
import { queryKeys } from '../../api/queryKeys';
import type { Engineer } from '../../api/types';

/**
 * Reading and maintaining the engineer roster.
 *
 * Every row carries `active_ticket_count`, which the API computes in SQL, so
 * the capacity bars and the assign dialog's ordering are reading a number the
 * database produced rather than one the client counted.
 */

/**
 * One page of engineers with their workload. Staff only.
 *
 * `enabled` exists for the one caller that cannot know in advance whether it
 * is allowed to ask: the applied-filter chips resolve an assignee's id to a
 * name, and an employee following a link with `?assignee_id=` in it would
 * otherwise send a request the API answers with 403.
 */
export function useEngineers(query: engineersApi.EngineerQuery = {}, enabled = true) {
  return useQuery({
    queryKey: queryKeys.engineers.list(query),
    queryFn: () => engineersApi.listEngineers(query),
    enabled,
  });
}

/** Create an engineer, returning the temporary password shown once. */
export function useCreateEngineer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: engineersApi.createEngineer,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.engineers.all });
      // A new engineer is also a new user account.
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
  });
}

/** An admin's update to an engineer. */
export function useUpdateEngineer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      payload,
    }: {
      userId: string;
      payload: engineersApi.EngineerUpdatePayload;
    }) => engineersApi.updateEngineer(userId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.engineers.all }),
  });
}

/** An engineer's update to their own availability or phone. */
export function useUpdateOwnProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: engineersApi.updateOwnProfile,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.engineers.all }),
  });
}

/** Deactivate an engineer. Accounts are never deleted. */
export function useDeactivateEngineer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: engineersApi.deactivateEngineer,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.engineers.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
    },
  });
}

/**
 * Order engineers the way the assign dialog offers them.
 *
 * Specialty match first, then lowest current load. The reasoning is that an
 * admin assigning a network problem wants the network engineers at the top,
 * and among those wants the one with room — an alphabetical list makes them
 * read every row and do that arithmetic themselves.
 *
 * Availability is deliberately *not* part of the sort. Someone on leave still
 * belongs in the list, because assigning to them is allowed and sometimes
 * right; their row says so, and the API returns a warning when it happens.
 */
export function sortForAssignment(engineers: Engineer[], groupId: string | null): Engineer[] {
  return [...engineers].sort((left, right) => {
    const leftMatches = groupId ? left.specialty_group_ids.includes(groupId) : false;
    const rightMatches = groupId ? right.specialty_group_ids.includes(groupId) : false;

    if (leftMatches !== rightMatches) {
      return leftMatches ? -1 : 1;
    }
    if (left.active_ticket_count !== right.active_ticket_count) {
      return left.active_ticket_count - right.active_ticket_count;
    }
    return left.full_name.localeCompare(right.full_name);
  });
}
