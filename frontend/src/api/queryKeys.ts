import type { EngineerQuery } from './engineers';
import type { IncidentQuery, IncidentSuggestionQuery } from './incidents';
import type { NotificationQuery } from './notifications';
import type { ReportPeriodParams, ReportScopeParams } from './reports';
import type { UserQuery } from './users';

/**
 * Central registry of TanStack Query cache keys.
 *
 * Every key in one module means a mutation can invalidate exactly the right
 * queries without guessing at key shapes spelled out across features — and
 * when a key shape changes, one file changes.
 *
 * The convention is a widening prefix: `['incidents']` is the prefix of
 * `['incidents', 'list', filters]`, so invalidating the former re-fetches
 * every list however it was filtered. TanStack Query matches keys by prefix,
 * which is what makes that work.
 */
export const queryKeys = {
  health: ['health'] as const,

  incidents: {
    all: ['incidents'] as const,
    list: (query: IncidentQuery) => ['incidents', 'list', query] as const,
    detail: (id: string) => ['incidents', 'detail', id] as const,
    transitions: (id: string) => ['incidents', 'detail', id, 'allowed-transitions'] as const,
    activity: (id: string) => ['incidents', 'detail', id, 'activity'] as const,
    /**
     * Possible duplicates for a report in progress.
     *
     * `null` is the key for "there is not yet enough to ask" — a subcategory
     * without a building. It is a real key rather than an absent one because
     * `useQuery` needs a key whether or not it is enabled, and keeping the
     * unanswerable case distinct means it can never share a cache entry with
     * a real question. Under the `incidents` prefix on purpose: reporting a
     * ticket changes what counts as a duplicate of the next one.
     */
    suggestions: (query: IncidentSuggestionQuery | null) =>
      ['incidents', 'suggestions', query] as const,
  },

  categories: {
    all: ['categories'] as const,
    tree: (includeInactive: boolean) => ['categories', 'tree', includeInactive] as const,
  },

  facilities: {
    all: ['facilities'] as const,
    tree: (includeInactive: boolean) => ['facilities', 'tree', includeInactive] as const,
    seats: (floorId: string, includeInactive: boolean) =>
      ['facilities', 'seats', floorId, includeInactive] as const,
  },

  engineers: {
    all: ['engineers'] as const,
    list: (query: EngineerQuery) => ['engineers', 'list', query] as const,
    detail: (userId: string) => ['engineers', 'detail', userId] as const,
  },

  users: {
    all: ['users'] as const,
    list: (query: UserQuery) => ['users', 'list', query] as const,
  },

  /**
   * The notification inbox.
   *
   * `all` is the prefix both of the others share, which is what makes one
   * `invalidateQueries({ queryKey: queryKeys.notifications.all })` after
   * marking something read refresh the badge and every filter of the list at
   * once — the two must never disagree about how many are unread.
   */
  notifications: {
    all: ['notifications'] as const,
    list: (query: NotificationQuery) => ['notifications', 'list', query] as const,
    unreadCount: ['notifications', 'unread-count'] as const,
  },

  /**
   * The dashboards.
   *
   * The period reports and the current-state reports are keyed by different
   * parameter types, which is what keeps them from sharing a cache entry: two
   * requests that differ only in whether a date range applied must never
   * answer each other. See decision D9.
   */
  reports: {
    all: ['reports'] as const,
    summary: (params: ReportPeriodParams) => ['reports', 'summary', params] as const,
    categories: (params: ReportPeriodParams) => ['reports', 'categories', params] as const,
    locations: (params: ReportPeriodParams) => ['reports', 'locations', params] as const,
    responseTimes: (params: ReportPeriodParams) => ['reports', 'response-times', params] as const,
    engineerWorkload: (params: ReportPeriodParams) =>
      ['reports', 'engineer-workload', params] as const,
    engineerDetail: (userId: string, params: ReportPeriodParams) =>
      ['reports', 'engineer-detail', userId, params] as const,
    /**
     * One page of one engineer's reviews.
     *
     * Under the `reports` prefix rather than `incidents`, although a rating
     * lives on a ticket — because what invalidates this is the same thing
     * that invalidates the average above it, and `invalidateIncidents`
     * already clears both prefixes after any change to a ticket.
     */
    engineerReviews: (
      userId: string,
      params: ReportPeriodParams & { rating?: number; page?: number },
    ) =>
      ['reports', 'engineer-reviews', userId, params] as const,
    communication: (params: ReportPeriodParams) => ['reports', 'communication', params] as const,
    blockedEscalated: (params: ReportScopeParams) =>
      ['reports', 'blocked-escalated', params] as const,
    me: (params: ReportScopeParams) => ['reports', 'me', params] as const,
  },
} as const;
