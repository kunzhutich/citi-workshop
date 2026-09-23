import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import * as incidentsApi from '../../api/incidents';
import * as notesApi from '../../api/notes';
import { queryKeys } from '../../api/queryKeys';
import type { NoteVisibility } from '../../api/types';

/**
 * Reading and changing incidents.
 *
 * Three queries make up the detail page, and they are deliberately separate
 * requests: the ticket, the moves its viewer may make, and its activity. They
 * change at different rates and after different actions — adding a note
 * changes the activity and nothing else — and keeping them apart means a note
 * does not re-render the action buttons.
 *
 * Every mutation invalidates the whole `['incidents']` prefix. That is broader
 * than strictly necessary, and it is the right default here: a transition can
 * change the ticket, its available moves, its activity *and* its position in
 * any list that filters on status. Working out which of those a given move
 * touched would put the workflow's side effects in a second place.
 */

/** One page of incidents matching the filters. */
export function useIncidents(query: incidentsApi.IncidentQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.incidents.list(query),
    queryFn: () => incidentsApi.listIncidents(query),
    enabled,
  });
}

/**
 * The same list, accumulated page by page, for the phone's "Load more".
 *
 * A separate hook rather than a flag on `useIncidents`, because the two answer
 * different questions: a table shows *a* page and lets you jump between them,
 * a card list shows everything loaded so far. Both are called on every list
 * screen and `enabled` decides which one actually fetches, so the hook order
 * never changes when the viewport crosses 900px.
 */
export function useIncidentsInfinite(query: incidentsApi.IncidentQuery, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: queryKeys.incidents.list({ ...query, page: undefined }),
    queryFn: ({ pageParam }) => incidentsApi.listIncidents({ ...query, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.page * lastPage.page_size;
      return loaded < lastPage.total ? lastPage.page + 1 : undefined;
    },
    enabled,
  });
}

/** One ticket in full, with the caller's `can_*` flags. */
export function useIncident(id: string) {
  return useQuery({
    queryKey: queryKeys.incidents.detail(id),
    queryFn: () => incidentsApi.fetchIncident(id),
  });
}

/**
 * The workflow moves available to this caller on this ticket, right now.
 *
 * The only thing the UI may draw workflow buttons from. `staleTime: 0` because
 * the answer depends on the ticket's current status: a cached list of moves is
 * a list of buttons that 409 when pressed.
 */
export function useAllowedTransitions(id: string) {
  return useQuery({
    queryKey: queryKeys.incidents.transitions(id),
    queryFn: () => incidentsApi.fetchAllowedTransitions(id),
    staleTime: 0,
  });
}

/** The merged events-and-notes timeline for one ticket. */
export function useActivity(id: string) {
  return useQuery({
    queryKey: queryKeys.incidents.activity(id),
    queryFn: () => incidentsApi.fetchActivity(id),
  });
}

/**
 * Re-read everything about incidents after a change to one of them.
 *
 * Also the reports, from M7 on. Every persona home screen and the whole admin
 * dashboard are built from `/reports/*`, so confirming a ticket fixed changes
 * "Awaiting your confirmation" as surely as it changes the ticket — and a tile
 * that still says 1 after the list beneath it emptied is the kind of stale
 * number that makes a reader stop trusting the rest.
 */
function invalidateIncidents(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.incidents.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.reports.all }),
  ]).then(() => undefined);
}

/** Report a new incident. */
export function useCreateIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: incidentsApi.createIncident,
    onSuccess: () => invalidateIncidents(queryClient),
  });
}

/** Edit a ticket's content or priority. */
export function useUpdateIncident(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: incidentsApi.IncidentUpdatePayload) =>
      incidentsApi.updateIncident(id, payload),
    onSuccess: () => invalidateIncidents(queryClient),
  });
}

/** Perform a workflow transition. */
export function useTransition(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: incidentsApi.TransitionPayload) =>
      incidentsApi.performTransition(id, payload),
    onSuccess: () => invalidateIncidents(queryClient),
  });
}

/** Assign a ticket to an engineer, or unassign it with `null`. */
export function useAssignIncident(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assigneeId: string | null) => incidentsApi.assignIncident(id, assigneeId),
    // Also the engineer list: `active_ticket_count` and every capacity bar
    // drawn from it have just changed for two people.
    onSuccess: async () => {
      await invalidateIncidents(queryClient);
      await queryClient.invalidateQueries({ queryKey: queryKeys.engineers.all });
    },
  });
}

/** Self-assign an unassigned open ticket. */
export function usePickUpIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => incidentsApi.pickUpIncident(id),
    onSuccess: async () => {
      await invalidateIncidents(queryClient);
      await queryClient.invalidateQueries({ queryKey: queryKeys.engineers.all });
    },
  });
}

/** Flag a ticket as needing attention. */
export function useEscalateIncident(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => incidentsApi.escalateIncident(id, reason),
    onSuccess: () => invalidateIncidents(queryClient),
  });
}

/** Clear an escalation, optionally re-prioritising at the same time. */
export function useClearEscalation(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof incidentsApi.clearEscalation>[1]) =>
      incidentsApi.clearEscalation(id, payload),
    onSuccess: () => invalidateIncidents(queryClient),
  });
}

/** Add a note to a ticket. */
export function useAddNote(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { body: string; visibility: NoteVisibility }) =>
      notesApi.createNote(id, payload),
    onSuccess: () => invalidateIncidents(queryClient),
  });
}
