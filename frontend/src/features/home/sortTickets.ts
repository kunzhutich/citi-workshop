import type { IncidentListItem, IncidentPriority } from '../../api/types';

/** Most urgent first. The order `?sort=-priority` produces on the server. */
const PRIORITY_RANK: Record<IncidentPriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

/**
 * Most urgent first, oldest first within a priority.
 *
 * BUILD-PLAN section 10 asks an engineer's home screen for "my active tickets
 * sorted by priority then age", and `GET /incidents` offers no compound sort —
 * `IncidentSort` is a flat list of single columns. So the server orders by
 * `-priority` and this settles the ties.
 *
 * Sorting the fetched page rather than the whole queue is sound *for this
 * use*: `-priority` already guarantees the page holds the most urgent tickets,
 * and this only decides their order among themselves. It would not be sound as
 * a general list sort — page two of a client-sorted list is not the second
 * page of anything — which is why the full My queue screen uses the server's
 * ordering and this helper lives beside the home screen that can afford it.
 */
export function sortByPriorityThenAge(incidents: IncidentListItem[]): IncidentListItem[] {
  return [...incidents].sort((left, right) => {
    const byPriority = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
    if (byPriority !== 0) {
      return byPriority;
    }
    return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  });
}
