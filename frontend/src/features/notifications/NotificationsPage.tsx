import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import ChatBubbleOutlinedIcon from '@mui/icons-material/ChatBubbleOutlined';
import DoneIcon from '@mui/icons-material/Done';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import OutlinedFlagIcon from '@mui/icons-material/OutlinedFlag';
import SyncAltIcon from '@mui/icons-material/SyncAlt';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { ComponentType } from 'react';
import { Fragment, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';

import type { AppNotification } from '../../api/notifications';
import type { NotificationType } from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState, QueryState } from '../../components/QueryState';
import { StatusChip } from '../../components/StatusChip';
import { relativeTime } from '../../display/time';
import { incidentPath } from '../../routes';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationFeed,
  useUnreadCount,
} from './hooks';

/**
 * One icon per kind of notification.
 *
 * A `Record` rather than a lookup with a fallback, for the same reason
 * `display/labels.ts` uses one: adding a member to `NotificationType` without
 * deciding what it looks like is a compile error here instead of a blank
 * square on somebody's screen.
 *
 * The icons are **decoration**. Every row's message says in words what
 * happened, and Material UI marks its icons `aria-hidden`, so nothing is
 * carried by the picture alone.
 */
const NOTIFICATION_ICONS: Record<NotificationType, ComponentType<SvgIconProps>> = {
  STATUS_CHANGED: SyncAltIcon,
  ASSIGNED: AssignmentIndIcon,
  NOTE_ADDED: ChatBubbleOutlinedIcon,
  ESCALATION_CLEARED: OutlinedFlagIcon,
};

type Filter = 'all' | 'unread';

/**
 * The notification inbox.
 *
 * **Unread is marked three ways, and one of them is a word.** The row is
 * tinted, the message is bold, and there is a "New" chip. Colour alone would
 * fail WCAG 1.4.1 and weight alone is invisible to a screen reader; the chip
 * is the channel that survives both.
 *
 * **Opening a notification marks it read**, because following a link is what
 * reading one means. The tick beside an unread row is for the other case —
 * clearing something you have decided you do not need to open — and "Mark all
 * as read" is the same thing for the whole inbox in one request.
 *
 * The ticket's *current* status is shown beside the message on purpose. The
 * message is a stored sentence about a moment; the chip says where the ticket
 * stands now, and the difference between them is often the reason to open it.
 * It is labelled "Now" because unlabelled it read as a contradiction — see the
 * comment on that line, which is a defect found by looking at the screen
 * rather than by any test.
 */
export function NotificationsPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const feed = useNotificationFeed(filter === 'unread' ? { unread_only: true } : {});
  const unreadCount = useUnreadCount();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const notifications = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const total = feed.data?.pages[0]?.total ?? 0;
  const unread = unreadCount.data?.unread ?? 0;

  return (
    <Box>
      <PageHeader
        title="Notifications"
        description="Updates on the tickets you reported and the ones assigned to you."
        actions={
          <Button
            variant="outlined"
            startIcon={<DoneAllIcon />}
            disabled={unread === 0 || markAllRead.isPending}
            loading={markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            Mark all as read
          </Button>
        }
      />

      <ToggleButtonGroup
        exclusive
        size="small"
        value={filter}
        aria-label="Filter notifications"
        onChange={(_event, next: Filter | null) => {
          // `exclusive` gives null when the active button is pressed again.
          // Ignoring it keeps one filter always chosen, rather than leaving
          // the group in a state with no answer to "what am I looking at?".
          if (next !== null) {
            setFilter(next);
          }
        }}
        sx={{ mb: 2 }}
      >
        <ToggleButton value="all">All</ToggleButton>
        <ToggleButton value="unread">Unread{unread > 0 ? ` (${unread})` : ''}</ToggleButton>
      </ToggleButtonGroup>

      <QueryState
        isPending={feed.isPending}
        error={feed.error}
        errorFallback="Your notifications could not be loaded."
        loadingLabel="Loading your notifications…"
      >
        {notifications.length === 0 ? (
          <EmptyState
            title={filter === 'unread' ? 'Nothing unread' : 'No notifications yet'}
            description={
              filter === 'unread'
                ? 'You are up to date.'
                : 'When somebody updates a ticket you reported or are working on, it will appear here.'
            }
          />
        ) : (
          <Paper variant="outlined">
            {/*
              A real list. `ListItemButton` rendered as a router link is an
              `<a>`, and an `<a>` as a direct child of a `<ul>` is a serious
              axe `list` violation — the `<li>` wrapper is what makes "item 2
              of 12" possible. Same lesson as the navigation in S6.
            */}
            <List disablePadding aria-label="Notifications">
              {notifications.map((notification, index) => (
                <Fragment key={notification.id}>
                  {index > 0 ? <Divider component="li" /> : null}
                  <NotificationRow
                    notification={notification}
                    onOpen={() =>
                      markRead.mutate({
                        id: notification.id,
                        wasUnread: notification.read_at === null,
                      })
                    }
                    onMarkRead={() =>
                      markRead.mutate({
                        id: notification.id,
                        wasUnread: notification.read_at === null,
                      })
                    }
                  />
                </Fragment>
              ))}
            </List>
          </Paper>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          {feed.hasNextPage ? (
            <Button
              variant="outlined"
              onClick={() => void feed.fetchNextPage()}
              loading={feed.isFetchingNextPage}
            >
              Load more
            </Button>
          ) : notifications.length > 0 ? (
            <Typography variant="caption" color="text.secondary">
              {total} {total === 1 ? 'notification' : 'notifications'}
            </Typography>
          ) : null}
        </Box>
      </QueryState>
    </Box>
  );
}

interface NotificationRowProps {
  notification: AppNotification;
  onOpen: () => void;
  onMarkRead: () => void;
}

/** One line of the inbox: what happened, which ticket, and how long ago. */
function NotificationRow({ notification, onOpen, onMarkRead }: NotificationRowProps) {
  const Icon = NOTIFICATION_ICONS[notification.type];
  const isUnread = notification.read_at === null;

  return (
    <ListItem
      disablePadding
      // The tick sits beside the link rather than inside it: a button nested
      // in an anchor is invalid, and clicking it would follow the link.
      secondaryAction={
        isUnread ? (
          <Tooltip title="Mark as read">
            <IconButton
              edge="end"
              aria-label={`Mark "${notification.message}" as read`}
              onClick={onMarkRead}
            >
              <DoneIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : undefined
      }
      sx={isUnread ? { bgcolor: 'action.hover' } : undefined}
    >
      <ListItemButton
        component={RouterLink}
        to={incidentPath(notification.incident_id)}
        onClick={onOpen}
        alignItems="flex-start"
        sx={{ py: 1.5, pr: isUnread ? 7 : 2 }}
      >
        <ListItemIcon sx={{ minWidth: 44, mt: 0.25 }}>
          <Icon fontSize="small" color={isUnread ? 'primary' : 'disabled'} />
        </ListItemIcon>
        <ListItemText
          primary={notification.message}
          slotProps={{
            primary: { sx: { fontWeight: isUnread ? 600 : 400 } },
            // A `<div>`, because the line below holds chips and the default
            // `<p>` cannot legally contain them.
            secondary: { component: 'div' },
          }}
          secondary={
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 1,
                mt: 0.75,
              }}
            >
              {isUnread ? <Chip label="New" size="small" color="primary" /> : null}
              <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0 }}>
                {notification.incident_reference} · {notification.incident_title}
              </Typography>
              {/*
                The word "Now" is load-bearing, and it was added after looking
                at the screen. The message is a stored sentence about a moment
                — "is now In progress" — and the chip is the ticket's *current*
                status, which may be something else entirely. Unlabelled, the
                two sat side by side reading as a contradiction: "is now In
                progress" next to a green Resolved chip. Two words fix it, and
                a screen reader gets them too.
              */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  Now
                </Typography>
                <StatusChip status={notification.incident_status} />
              </Box>
              <Typography variant="caption" color="text.secondary">
                {relativeTime(notification.created_at)}
              </Typography>
            </Box>
          }
        />
      </ListItemButton>
    </ListItem>
  );
}
