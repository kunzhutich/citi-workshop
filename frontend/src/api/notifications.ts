import { apiClient } from './client';
import type { IncidentStatus, NotificationType, Page } from './types';

/**
 * The notification inbox.
 *
 * Four calls, and the split between them is the point. `fetchUnreadCount` is
 * polled by the bell every thirty seconds in every open tab and returns a
 * single integer; everything else happens only when somebody opens the
 * notifications page. Reading the count through the list endpoint would have
 * been one fewer function and would have made the busiest request in the
 * application carry a page of rows it never renders.
 *
 * There is no websocket, and there was never a choice about it: the API is a
 * Lambda behind a Function URL, which cannot hold a connection open. Polling
 * is the shape the platform allows, so the endpoint it polls is built to be
 * cheap — see `repositories/notifications.py::unread_count`.
 */

/** Mirrors `NotificationRead`. */
export interface AppNotification {
  id: string;
  type: NotificationType;
  /**
   * The sentence exactly as it was stored when the thing happened.
   *
   * Never re-rendered from the ticket's current state: "Your ticket is now
   * Resolved" stays what it was, even after the ticket has been reopened.
   */
  message: string;
  /** Null while unread. */
  read_at: string | null;
  created_at: string;

  incident_id: string;
  incident_reference: string;
  /** Read live, so a renamed ticket appears under its current title. */
  incident_title: string;
  /** Where the ticket stands *now*, which is how the reader judges the message. */
  incident_status: IncidentStatus;
}

/** Mirrors `UnreadCount`. */
export interface UnreadCount {
  unread: number;
}

/** Mirrors `MarkAllReadResult`. */
export interface MarkAllReadResult {
  marked: number;
}

/** Query string of the inbox list. */
export interface NotificationQuery {
  unread_only?: boolean;
  page?: number;
  page_size?: number;
}

/** The number on the bell. One integer, polled; nothing else belongs here. */
export async function fetchUnreadCount(): Promise<UnreadCount> {
  const { data } = await apiClient.get<UnreadCount>('/notifications/unread-count');
  return data;
}

/** One page of the caller's own notifications, newest first. */
export async function fetchNotifications(
  query: NotificationQuery = {},
): Promise<Page<AppNotification>> {
  const { data } = await apiClient.get<Page<AppNotification>>('/notifications', {
    params: query,
  });
  return data;
}

/** Mark one notification read. Idempotent; the first timestamp stands. */
export async function markNotificationRead(notificationId: string): Promise<AppNotification> {
  const { data } = await apiClient.post<AppNotification>(
    `/notifications/${notificationId}/read`,
  );
  return data;
}

/** Clear the badge in one request, and report how many rows it moved. */
export async function markAllNotificationsRead(): Promise<MarkAllReadResult> {
  const { data } = await apiClient.post<MarkAllReadResult>('/notifications/read-all');
  return data;
}
