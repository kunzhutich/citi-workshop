import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import * as notificationsApi from '../../api/notifications';
import type { NotificationQuery } from '../../api/notifications';
import { queryKeys } from '../../api/queryKeys';

/**
 * Reading and clearing the notification inbox.
 *
 * **Polling, every thirty seconds, and not by preference.** The API is a
 * Lambda behind a Function URL; a Function URL cannot hold a connection open,
 * so there is no websocket to choose instead. What is left is to make the
 * polled request as small as possible — one integer, from an index-only scan —
 * and to poll it no more often than a person would notice.
 *
 * Two things stop that becoming a request every thirty seconds forever:
 *
 * * TanStack Query does not run a `refetchInterval` while the window is
 *   unfocused (`refetchIntervalInBackground` defaults to false), so a tab left
 *   open behind another one stops asking. That matters more here than it
 *   looks: Aurora runs at `min_capacity = 0` and sleeps when idle, and a poll
 *   that never stopped would be a bill for keeping it awake.
 * * `staleTime` is just under the interval, so a window regaining focus
 *   inside the same tick reuses the answer instead of adding a request.
 */

/** How often the bell asks, in milliseconds. BUILD-PLAN section 15 sets this. */
export const UNREAD_POLL_INTERVAL_MS = 30_000;

/**
 * The number on the bell.
 *
 * Mounted once, in `AppShell`, so the interval exists once per tab however
 * many components want to read the count.
 */
export function useUnreadCount() {
  return useQuery({
    queryKey: queryKeys.notifications.unreadCount,
    queryFn: notificationsApi.fetchUnreadCount,
    refetchInterval: UNREAD_POLL_INTERVAL_MS,
    staleTime: UNREAD_POLL_INTERVAL_MS - 1_000,
    // A failed poll is not worth a red banner on every screen in the
    // application; the badge simply keeps its last value until the next tick.
    retry: 1,
  });
}

/**
 * The caller's notifications, newest first, a page at a time.
 *
 * Infinite rather than paged, matching the ticket lists on a phone: an inbox
 * is a stream, and "page 3 of 7" is not how anybody reads one. `page` is
 * dropped from the cache key so that loading more does not create a second
 * cache entry for the same filter.
 */
export function useNotificationFeed(query: NotificationQuery) {
  return useInfiniteQuery({
    queryKey: queryKeys.notifications.list({ ...query, page: undefined }),
    queryFn: ({ pageParam }) => notificationsApi.fetchNotifications({ ...query, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.page * lastPage.page_size;
      return loaded < lastPage.total ? lastPage.page + 1 : undefined;
    },
  });
}

/**
 * Mark one notification read.
 *
 * Invalidates the whole `['notifications']` prefix rather than the one list it
 * came from: the badge and the list are two views of the same rows, and a
 * screen where the list says "read" while the bell still says 3 is worse than
 * one extra request.
 */
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: notificationsApi.markNotificationRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
    },
  });
}

/** Clear the badge in one request. */
export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: notificationsApi.markAllNotificationsRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
    },
  });
}
