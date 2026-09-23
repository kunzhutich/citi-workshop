import { screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { renderWithAuth } from '../../test/renderWithProviders';

/**
 * The bell, and the one thing about it that is easy to get wrong.
 *
 * A badge is a number in a coloured circle. To a screen reader that is a
 * stray "3" inside a control called "Notifications" — so the count has to be
 * in the control's *name*, and the badge itself has to be out of the
 * accessibility tree. These tests hold both halves of that.
 */

vi.mock('../../api/notifications', () => ({
  fetchUnreadCount: vi.fn(),
  fetchNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

const { fetchUnreadCount } = await import('../../api/notifications');
const { NotificationBell } = await import('./NotificationBell');

const fetchUnreadCountMock = vi.mocked(fetchUnreadCount);

beforeEach(() => {
  vi.clearAllMocks();
});

it('names itself plainly when there is nothing unread', async () => {
  fetchUnreadCountMock.mockResolvedValue({ unread: 0 });

  renderWithAuth(<NotificationBell />);

  await waitFor(() => {
    expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument();
  });
});

it('puts the count in the accessible name, not only in the badge', async () => {
  fetchUnreadCountMock.mockResolvedValue({ unread: 3 });

  renderWithAuth(<NotificationBell />);

  const link = await screen.findByRole('link', { name: 'Notifications, 3 unread' });
  expect(link).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();
});

it('hides the badge number from assistive technology', async () => {
  fetchUnreadCountMock.mockResolvedValue({ unread: 3 });

  renderWithAuth(<NotificationBell />);

  await screen.findByRole('link', { name: 'Notifications, 3 unread' });
  // Without this the control is announced as "Notifications, 3 unread" and
  // then "3" again, which reads as a second, unexplained number.
  expect(screen.getByText('3')).toHaveAttribute('aria-hidden', 'true');
});

it('caps the badge rather than printing a number nobody reads', async () => {
  fetchUnreadCountMock.mockResolvedValue({ unread: 1234 });

  renderWithAuth(<NotificationBell />);

  expect(await screen.findByText('99+')).toBeInTheDocument();
  // The exact figure survives in the name, where it costs no layout.
  expect(screen.getByRole('link', { name: 'Notifications, 1234 unread' })).toBeInTheDocument();
});

it('links to the notifications page rather than opening a menu', async () => {
  fetchUnreadCountMock.mockResolvedValue({ unread: 1 });

  renderWithAuth(<NotificationBell />);

  const link = await screen.findByRole('link', { name: 'Notifications, 1 unread' });
  expect(link).toHaveAttribute('href', '/notifications');
});

it('shows no badge, and no failure, when the poll errors', async () => {
  fetchUnreadCountMock.mockRejectedValue(new Error('network'));

  renderWithAuth(<NotificationBell />);

  // A failed poll must not put an alert on every screen in the application:
  // the bell simply reads as empty until the next tick succeeds.
  await waitFor(() => {
    expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument();
  });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
