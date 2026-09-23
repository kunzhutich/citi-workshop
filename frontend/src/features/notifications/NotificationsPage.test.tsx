import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

import type { AppNotification } from '../../api/notifications';
import type { Page } from '../../api/types';
import { renderWithAuth } from '../../test/renderWithProviders';

/**
 * The inbox screen.
 *
 * Three things here would fail quietly rather than loudly:
 *
 * 1. **Unread is not signalled by colour alone.** A tinted row and a bolder
 *    line are invisible to a screen reader and to anybody who cannot
 *    distinguish the tint; the "New" chip is the channel that survives both,
 *    and a refactor that dropped it would look fine in a screenshot.
 * 2. **Opening a notification marks it read.** Following the link is what
 *    reading one means, and a screen where the badge outlives the reading is
 *    a badge nobody believes.
 * 3. **"Mark all as read" is disabled when there is nothing to mark.** An
 *    enabled button that does nothing teaches people the screen is broken.
 */

vi.mock('../../api/notifications', () => ({
  fetchUnreadCount: vi.fn(),
  fetchNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

const { fetchUnreadCount, fetchNotifications, markNotificationRead, markAllNotificationsRead } =
  await import('../../api/notifications');
const { NotificationsPage } = await import('./NotificationsPage');

const fetchUnreadCountMock = vi.mocked(fetchUnreadCount);
const fetchNotificationsMock = vi.mocked(fetchNotifications);
const markNotificationReadMock = vi.mocked(markNotificationRead);
const markAllNotificationsReadMock = vi.mocked(markAllNotificationsRead);

function makeNotification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n1',
    type: 'STATUS_CHANGED',
    message: 'Your ticket INC-000123 is now Resolved.',
    read_at: null,
    created_at: new Date().toISOString(),
    incident_id: 'i1',
    incident_reference: 'INC-000123',
    incident_title: 'Monitor flickers',
    incident_status: 'RESOLVED',
    ...overrides,
  };
}

function page(items: AppNotification[], total = items.length): Page<AppNotification> {
  return { items, total, page: 1, page_size: 25 };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchUnreadCountMock.mockResolvedValue({ unread: 0 });
  markNotificationReadMock.mockResolvedValue(makeNotification({ read_at: 'now' }));
  markAllNotificationsReadMock.mockResolvedValue({ marked: 0 });
});

it('lists each notification with its ticket and current status', async () => {
  fetchNotificationsMock.mockResolvedValue(page([makeNotification()]));

  renderWithAuth(<NotificationsPage />);

  expect(
    await screen.findByText('Your ticket INC-000123 is now Resolved.'),
  ).toBeInTheDocument();
  expect(screen.getByText(/INC-000123 · Monitor flickers/)).toBeInTheDocument();
  expect(screen.getByText('Resolved')).toBeInTheDocument();
});

it('marks an unread row with a word, not only with a colour', async () => {
  fetchNotificationsMock.mockResolvedValue(
    page([
      makeNotification({ read_at: null }),
      makeNotification({ id: 'n2', read_at: 'then', message: 'INC-000124 is now Closed.' }),
    ]),
  );

  renderWithAuth(<NotificationsPage />);

  await screen.findByText('INC-000124 is now Closed.');
  // One "New" chip for the one unread row. Text, so it reaches a screen
  // reader and survives a monochrome screenshot.
  expect(screen.getAllByText('New')).toHaveLength(1);
});

it('offers a per-row tick only while a notification is unread', async () => {
  fetchNotificationsMock.mockResolvedValue(
    page([
      makeNotification({ read_at: null }),
      makeNotification({ id: 'n2', read_at: 'then', message: 'INC-000124 is now Closed.' }),
    ]),
  );

  renderWithAuth(<NotificationsPage />);

  await screen.findByText('INC-000124 is now Closed.');
  const ticks = screen.getAllByRole('button', { name: /^Mark ".+" as read$/ });
  expect(ticks).toHaveLength(1);
});

it('marks a notification read when its tick is pressed', async () => {
  const user = userEvent.setup();
  fetchNotificationsMock.mockResolvedValue(page([makeNotification()]));

  renderWithAuth(<NotificationsPage />);

  await screen.findByText('Your ticket INC-000123 is now Resolved.');
  await user.click(screen.getByRole('button', { name: /^Mark ".+" as read$/ }));

  // The id, and only the id, is asserted: TanStack Query hands a mutation
  // function a second argument of its own, so `toHaveBeenCalledWith('n1')`
  // would fail on a detail of the library rather than of this screen.
  await waitFor(() => {
    expect(markNotificationReadMock.mock.calls[0]?.[0]).toBe('n1');
  });
});

it('marks a notification read when it is opened', async () => {
  const user = userEvent.setup();
  fetchNotificationsMock.mockResolvedValue(page([makeNotification()]));

  renderWithAuth(<NotificationsPage />);

  const link = await screen.findByRole('link', {
    name: /Your ticket INC-000123 is now Resolved/,
  });
  expect(link).toHaveAttribute('href', '/tickets/i1');
  await user.click(link);

  await waitFor(() => {
    expect(markNotificationReadMock.mock.calls[0]?.[0]).toBe('n1');
  });
});

it('disables "Mark all as read" when nothing is unread', async () => {
  fetchUnreadCountMock.mockResolvedValue({ unread: 0 });
  fetchNotificationsMock.mockResolvedValue(page([makeNotification({ read_at: 'then' })]));

  renderWithAuth(<NotificationsPage />);

  await screen.findByText('Your ticket INC-000123 is now Resolved.');
  expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
});

it('clears the whole inbox in one request', async () => {
  const user = userEvent.setup();
  fetchUnreadCountMock.mockResolvedValue({ unread: 2 });
  fetchNotificationsMock.mockResolvedValue(page([makeNotification()]));

  renderWithAuth(<NotificationsPage />);

  await screen.findByText('Your ticket INC-000123 is now Resolved.');
  await user.click(screen.getByRole('button', { name: 'Mark all as read' }));

  await waitFor(() => {
    expect(markAllNotificationsReadMock).toHaveBeenCalledTimes(1);
  });
});

it('asks the API for unread only when the filter is switched', async () => {
  const user = userEvent.setup();
  fetchUnreadCountMock.mockResolvedValue({ unread: 1 });
  fetchNotificationsMock.mockResolvedValue(page([makeNotification()]));

  renderWithAuth(<NotificationsPage />);

  await screen.findByText('Your ticket INC-000123 is now Resolved.');
  await user.click(screen.getByRole('button', { name: /^Unread/ }));

  await waitFor(() => {
    expect(fetchNotificationsMock).toHaveBeenCalledWith({ unread_only: true, page: 1 });
  });
});

it('explains an empty inbox rather than showing an empty list', async () => {
  fetchNotificationsMock.mockResolvedValue(page([]));

  renderWithAuth(<NotificationsPage />);

  expect(await screen.findByText('No notifications yet')).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Notifications' })).not.toBeInTheDocument();
});

it('says something different when the unread filter is the reason it is empty', async () => {
  const user = userEvent.setup();
  fetchUnreadCountMock.mockResolvedValue({ unread: 0 });
  fetchNotificationsMock.mockResolvedValue(page([]));

  renderWithAuth(<NotificationsPage />);

  await screen.findByText('No notifications yet');
  await user.click(screen.getByRole('button', { name: /^Unread/ }));

  expect(await screen.findByText('Nothing unread')).toBeInTheDocument();
});

it('renders the rows as a real list, so their count is announced', async () => {
  fetchNotificationsMock.mockResolvedValue(
    page([makeNotification(), makeNotification({ id: 'n2', message: 'INC-000124 is now Closed.' })]),
  );

  renderWithAuth(<NotificationsPage />);

  const list = await screen.findByRole('list', { name: 'Notifications' });
  // `<a>` directly inside `<ul>` is a serious axe `list` violation and stops
  // a screen reader announcing "item 2 of 2". The `<li>` wrappers are what
  // this asserts.
  expect(within(list).getAllByRole('listitem').length).toBeGreaterThanOrEqual(2);
});

it('offers more only when there are more', async () => {
  fetchNotificationsMock.mockResolvedValue(page([makeNotification()], 1));

  renderWithAuth(<NotificationsPage />);

  await screen.findByText('Your ticket INC-000123 is now Resolved.');
  expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  expect(screen.getByText('1 notification')).toBeInTheDocument();
});

it('loads the next page on request', async () => {
  const user = userEvent.setup();
  fetchNotificationsMock.mockResolvedValue(page([makeNotification()], 30));

  renderWithAuth(<NotificationsPage />);

  await screen.findByText('Your ticket INC-000123 is now Resolved.');
  await user.click(screen.getByRole('button', { name: 'Load more' }));

  await waitFor(() => {
    expect(fetchNotificationsMock).toHaveBeenCalledWith({ page: 2 });
  });
});

it('explains a failure instead of showing an empty inbox', async () => {
  fetchNotificationsMock.mockRejectedValue(new Error('network'));

  renderWithAuth(<NotificationsPage />);

  expect(await screen.findByRole('alert')).toHaveTextContent(
    /could not be loaded|went wrong|network/i,
  );
  expect(screen.queryByText('No notifications yet')).not.toBeInTheDocument();
});
