import NotificationsIcon from '@mui/icons-material/Notifications';
import Badge from '@mui/material/Badge';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { Link as RouterLink } from 'react-router-dom';

import { paths } from '../../routes';
import { useUnreadCount } from './hooks';

/** Above this the badge reads "99+", because the exact number stops mattering. */
const BADGE_MAX = 99;

/**
 * The bell in the app bar, and the only thing that polls.
 *
 * It is a **link**, not a button that navigates: it goes somewhere, so a
 * screen reader should say "link", the browser should offer open-in-new-tab,
 * and the status bar should show where the click will land. The bottom bar was
 * changed to real anchors in S6 for the same reason.
 *
 * **The count is in the accessible name, not only in the badge.** A badge is a
 * number rendered in a coloured circle; to a screen reader it is a stray "3"
 * inside a control called "Notifications", which is at best confusing and at
 * worst read as part of the label. So the badge itself is hidden from the
 * accessibility tree and the whole fact is spelled out in one sentence —
 * "Notifications, 3 unread" — which is also what the tooltip says, so sighted
 * and unsighted users get the same words.
 *
 * **There is deliberately no live region.** A polite announcement every time
 * the poll finds something new would interrupt whatever the user was reading,
 * every thirty seconds, on every screen. The trade is that a screen-reader
 * user learns of a notification when they next reach the bell rather than the
 * moment it arrives; it is recorded as a known limitation in
 * `docs/DEPLOYMENT-CHECKLIST.md` rather than left as an accident.
 */
export function NotificationBell() {
  const { data } = useUnreadCount();
  const unread = data?.unread ?? 0;
  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';

  return (
    <Tooltip title={label}>
      <IconButton
        component={RouterLink}
        to={paths.notifications}
        color="inherit"
        aria-label={label}
      >
        <Badge
          badgeContent={unread}
          max={BADGE_MAX}
          color="error"
          // The number is decoration here: `aria-label` above already says it,
          // and a bare "3" announced inside the control is noise.
          slotProps={{ badge: { 'aria-hidden': true } }}
        >
          <NotificationsIcon />
        </Badge>
      </IconButton>
    </Tooltip>
  );
}
