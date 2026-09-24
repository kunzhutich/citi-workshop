import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import FlagIcon from '@mui/icons-material/Flag';
import LockIcon from '@mui/icons-material/Lock';
import PersonIcon from '@mui/icons-material/Person';
import ReplayIcon from '@mui/icons-material/Replay';
import StarBorderOutlinedIcon from '@mui/icons-material/StarBorderOutlined';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Rating from '@mui/material/Rating';
import Typography from '@mui/material/Typography';
import type { ReactElement } from 'react';

import type { ActivityEntry, EventType } from '../../api/types';
import { initialsOf } from '../../layout/roleLabels';
import { eventLabel, statusLabel } from '../../display/labels';
import { formatDateTime, relativeTime } from '../../display/time';

/**
 * A ticket's history: what the system recorded and what people wrote, merged.
 *
 * The API returns one chronological stream, already filtered — an employee's
 * response contains no INTERNAL notes to hide, because `services/visibility.py`
 * removes them **in the query**. This component therefore shades and labels
 * internal notes rather than deciding who may see them; if one reaches here,
 * the viewer is entitled to it.
 *
 * **Built from `Box` rather than MUI's `Timeline`.** `Timeline` lives in
 * `@mui/lab`, whose only release compatible with Material UI 9 is a beta. A
 * whole extra package, at beta, for a vertical rule and some dots was not a
 * trade worth making in a project judged on stability.
 */

/** Which icon narrates each kind of event. */
const EVENT_ICONS: Record<EventType, ReactElement> = {
  CREATED: <FlagIcon fontSize="small" />,
  STATUS_CHANGED: <ArrowForwardIcon fontSize="small" />,
  ASSIGNED: <PersonIcon fontSize="small" />,
  UNASSIGNED: <PersonIcon fontSize="small" />,
  PRIORITY_CHANGED: <SwapHorizIcon fontSize="small" />,
  ESCALATED: <FlagIcon fontSize="small" />,
  ESCALATION_CLEARED: <FlagIcon fontSize="small" />,
  NOTE_ADDED: <ChatBubbleOutlineIcon fontSize="small" />,
  MARKED_DUPLICATE: <SwapHorizIcon fontSize="small" />,
  REOPENED: <ReplayIcon fontSize="small" />,
};

/**
 * What each score means, in words.
 *
 * The same five sentences `FeedbackDialog` offers when the rating is given,
 * so what the reporter chose is what the engineer reads back. Duplicated
 * rather than shared because the two are in different features and the string
 * is presentation in both — but they are meant to stay equal, and
 * `ActivityTimeline.test.tsx` pins them against each other.
 */
const SCORE_WORDING: Record<number, string> = {
  1: 'Not fixed',
  2: 'Fixed poorly',
  3: 'Fixed',
  4: 'Fixed well',
  5: 'Could not have been better',
};

export interface ActivityTimelineProps {
  entries: ActivityEntry[];
  /**
   * Open the correction dialog for a rating. Absent where there is nowhere to
   * open one — the edit affordance is then simply not drawn, and `can_edit`
   * on the entry still decides whether it would have been.
   */
  onEditFeedback?: (entry: ActivityEntry) => void;
}

export function ActivityTimeline({ entries, onEditFeedback }: ActivityTimelineProps) {
  if (entries.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Nothing has happened to this ticket yet.
      </Typography>
    );
  }

  return (
    <Box component="ol" aria-label="Activity" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {entries.map((entry, index) => (
        <Box
          component="li"
          key={`${entry.kind}-${entry.id}`}
          sx={{ display: 'flex', gap: 2, position: 'relative', pb: 3 }}
        >
          {/* The vertical rule, drawn behind the dots and stopped short of the
              last one so the stream does not trail off into nothing. */}
          {index < entries.length - 1 ? (
            <Box
              aria-hidden
              sx={{
                position: 'absolute',
                left: 19,
                top: 40,
                bottom: 0,
                width: '2px',
                bgcolor: 'divider',
              }}
            />
          ) : null}

          {/*
            Three treatments for three kinds, because the eye should be able to
            skim the left rail and tell a machine record from a person's words
            from a judgement. Each pairing is a palette slot Material UI has
            filled `contrastText` for, rather than two colours picked here —
            see `theme.ts` on the slot that rendered grey when it was not.
          */}
          <Avatar
            sx={{
              width: 40,
              height: 40,
              flexShrink: 0,
              bgcolor: avatarColour(entry).bgcolor,
              color: avatarColour(entry).color,
              fontSize: '0.8rem',
            }}
          >
            {avatarContent(entry)}
          </Avatar>

          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 1 }}>
              <Typography variant="subtitle2" component="span">
                {entry.actor?.full_name ?? 'System'}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                component="time"
                title={formatDateTime(entry.created_at)}
              >
                {relativeTime(entry.created_at)}
              </Typography>
              {entry.kind === 'note' && entry.visibility === 'INTERNAL' ? (
                <Chip
                  label="Internal"
                  size="small"
                  color="warning"
                  variant="outlined"
                  icon={<LockIcon />}
                />
              ) : null}
            </Box>

            {entry.kind === 'feedback' ? (
              <Box
                sx={{
                  mt: 0.5,
                  p: 1.5,
                  borderRadius: 1,
                  bgcolor: 'action.hover',
                  border: '1px solid',
                  borderColor: 'primary.light',
                }}
              >
                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
                  {/*
                    Read-only stars, with the score in words beside them. Five
                    glyphs are not something a screen reader can total, and
                    MUI's own label for a read-only Rating is a bare "4 Stars"
                    — which says how many are lit and not what four means here.
                  */}
                  <Rating value={entry.rating} readOnly size="small" aria-hidden />
                  <Typography variant="subtitle2" component="span">
                    {entry.rating}/5 — {entry.rating === null ? '' : SCORE_WORDING[entry.rating]}
                  </Typography>
                </Box>

                {entry.rated_user ? (
                  <Typography variant="caption" color="text.secondary" component="p">
                    About {entry.rated_user.full_name}
                    {/* Which repair, but only once there has been more than
                        one — "repair 1" on a ticket fixed once is noise. */}
                    {entry.resolution_round && entry.resolution_round > 1
                      ? ` · repair ${entry.resolution_round}`
                      : ''}
                  </Typography>
                ) : null}

                <Typography
                  variant="body2"
                  sx={{ mt: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                >
                  {entry.comment}
                </Typography>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                  {entry.edited_at ? (
                    <Typography variant="caption" color="text.secondary">
                      edited {relativeTime(entry.edited_at)}
                    </Typography>
                  ) : null}
                  {entry.can_edit && onEditFeedback ? (
                    <Button size="small" onClick={() => onEditFeedback(entry)} sx={{ ml: -1 }}>
                      Change this
                    </Button>
                  ) : null}
                </Box>
              </Box>
            ) : entry.kind === 'note' ? (
              <Box
                sx={{
                  mt: 0.5,
                  p: 1.5,
                  borderRadius: 1,
                  // Shaded, so a staff-only note is distinguishable at a
                  // glance from one the reporter can also read.
                  bgcolor: entry.visibility === 'INTERNAL' ? 'warning.50' : 'action.hover',
                  border: '1px solid',
                  borderColor: entry.visibility === 'INTERNAL' ? 'warning.light' : 'transparent',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                }}
              >
                <Typography variant="body2">{entry.body}</Typography>
                {entry.edited_at ? (
                  <Typography variant="caption" color="text.secondary">
                    edited {relativeTime(entry.edited_at)}
                  </Typography>
                ) : null}
              </Box>
            ) : (
              <Box sx={{ mt: 0.25 }}>
                <Typography variant="body2">{describeEvent(entry)}</Typography>
                {entry.reason ? (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                  >
                    {entry.reason}
                  </Typography>
                ) : null}
              </Box>
            )}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/** The avatar's two colours for one kind of entry. */
function avatarColour(entry: ActivityEntry): { bgcolor: string; color: string } {
  if (entry.kind === 'feedback') {
    return { bgcolor: 'primary.main', color: 'primary.contrastText' };
  }
  if (entry.kind === 'note') {
    return { bgcolor: 'secondary.main', color: 'secondary.contrastText' };
  }
  return { bgcolor: 'action.selected', color: 'text.secondary' };
}

/** What sits inside the avatar: initials for words, an icon for the rest. */
function avatarContent(entry: ActivityEntry): ReactElement | string | null {
  if (entry.kind === 'feedback') {
    return <StarBorderOutlinedIcon fontSize="small" />;
  }
  if (entry.kind === 'note') {
    return initialsOf(entry.actor?.full_name ?? '?');
  }
  return (entry.event_type && EVENT_ICONS[entry.event_type]) ?? null;
}

/**
 * Narrate one event in a sentence.
 *
 * Values are stored as the enum members they are, so a status change reads
 * "Open → In progress" rather than "OPEN → IN_PROGRESS". An ASSIGNED event
 * stores a user **id**, which no client can resolve, so the API sends a
 * matching `*_label` and this prefers it — the raw value stays in the
 * response for anyone reading the audit trail rather than the screen.
 */
function describeEvent(entry: ActivityEntry): string {
  if (!entry.event_type) {
    return '';
  }
  const label = eventLabel(entry.event_type);
  const from = entry.from_label ?? (entry.from_value ? humanise(entry.from_value) : null);
  const to = entry.to_label ?? (entry.to_value ? humanise(entry.to_value) : null);

  if (from && to) {
    return `${label}: ${from} → ${to}`;
  }
  if (to) {
    return `${label}: ${to}`;
  }
  if (from) {
    return `${label}: ${from}`;
  }
  return label;
}

/** Render a stored enum member readably, leaving free text alone. */
function humanise(value: string): string {
  const statuses = ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'RESOLVED', 'CLOSED'] as const;
  const match = statuses.find((status) => status === value);
  if (match) {
    return statusLabel(match);
  }
  return value.includes('_') ? value.toLowerCase().replaceAll('_', ' ') : value;
}
