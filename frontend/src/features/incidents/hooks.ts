import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import * as feedbackApi from '../../api/feedback';
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

/**
 * Tickets that may already cover the problem being reported.
 *
 * **The gate is the whole feature.** `null` means the questionnaire has not
 * yet been told both of the things the question needs — a subcategory and a
 * building — and until it has, nothing is asked. That is a rule about when the
 * request is meaningful, so it lives here with the request rather than in the
 * component that draws the answer: `SuggestionPanel` decides only whether the
 * reporter has reached the point of *seeing* it.
 *
 * The fallback in `queryFn` is unreachable while `enabled` holds and exists
 * because a `queryFn` cannot be conditional in the way a key can. `''` for
 * both ids would be rejected by the API as a malformed uuid, which is the
 * loudest way for a broken gate to announce itself.
 */
export function useIncidentSuggestions(query: incidentsApi.IncidentSuggestionQuery | null) {
  return useQuery({
    queryKey: queryKeys.incidents.suggestions(query),
    queryFn: () =>
      incidentsApi.fetchIncidentSuggestions(query ?? { category_id: '', building_id: '' }),
    enabled: query !== null,
  });
}

/** The merged events, notes and ratings timeline for one ticket. */
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

/**
 * Subscribe the caller to a ticket, or unsubscribe them.
 *
 * One mutation for both directions, taking the ticket id with it rather than
 * closing over one, because the two callers want different things from it: the
 * ticket page has a single ticket and toggles it, while the questionnaire's
 * suggestion panel has a list of them and subscribes to whichever card was
 * pressed. A hook bound to an id would force one `useMutation` per card.
 *
 * It invalidates the whole `['incidents']` prefix like every other mutation
 * here, which includes the suggestions query — so the panel that was just
 * acted on re-reads rather than going quietly out of date.
 */
export function useSetWatching() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, watching }: { id: string; watching: boolean }) =>
      watching ? incidentsApi.watchIncident(id) : incidentsApi.unwatchIncident(id),
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

/**
 * Rate the current repair on a ticket.
 *
 * Invalidates the whole prefix like every other mutation here, and it has to:
 * the rating joins the activity timeline, and `can_give_feedback` on the
 * ticket itself has just become false, so a detail response left in the cache
 * would keep offering a button the API would now refuse.
 */
export function useCreateFeedback(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: feedbackApi.FeedbackPayload) => feedbackApi.createFeedback(id, payload),
    onSuccess: () => invalidateIncidents(queryClient),
  });
}

/** Correct a rating, within fifteen minutes of leaving it. */
export function useUpdateFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ feedbackId, ...payload }: feedbackApi.FeedbackPayload & { feedbackId: string }) =>
      feedbackApi.updateFeedback(feedbackId, payload),
    onSuccess: () => invalidateIncidents(queryClient),
  });
}
