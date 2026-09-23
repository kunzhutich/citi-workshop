import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';

import type { EscalatedTicket } from '../../api/reports';
import type { IncidentListItem } from '../../api/types';
import { EmptyState, QueryState } from '../../components/QueryState';
import { PriorityChip } from '../../components/PriorityChip';
import { StatusChip } from '../../components/StatusChip';
import { relativeTime } from '../../display/time';
import { AssignButton } from '../incidents/AssignButton';
import { ACTIVE_STATUSES, currentListLink } from './listLinks';
import { incidentPath } from '../../routes';

/** How long a ticket may sit unowned before it belongs in this panel. */
export const UNASSIGNED_HOURS = 24;

/**
 * How many rows each half of the panel shows.
 *
 * A cap, not a page. Against the demo data the unassigned half had twenty-six
 * rows and the escalated half sixteen, which made the dashboard twelve
 * thousand pixels tall on a phone and buried the blocked-by-reason panel
 * underneath them. The panel's job is "here is what needs somebody" — six rows
 * of that is a prompt to act, and thirty is a list to scroll past. The count in
 * the heading is the real total either way, and the link under the rows opens
 * all of them.
 */
const ROW_CAP = 6;

export interface NeedsAttentionPanelProps {
  /** The live escalations, from `/reports/blocked-escalated`. */
  escalated: EscalatedTicket[];
  /** How many there are in total, which may exceed the list's cap of 50. */
  escalatedTotal: number;
  /** Open, unowned tickets, oldest first. Filtered to the stale ones here. */
  unassigned: IncidentListItem[];
  isPending: boolean;
  error: unknown;
  /** The moment the snapshot describes, so ages are measured against it. */
  asOf: string | undefined;
  /** Carried into the "show all" links, which honour the same building. */
  buildingId: string;
}

/**
 * The two queues an admin is supposed to act on, each row with a way to act.
 *
 * **Both halves are current state and neither is windowed.** That is the whole
 * point of the panel: the ticket that has been escalated for three weeks and
 * the one nobody has picked up since last month are exactly the rows a date
 * filter would hide, and decision D9 removed the window from
 * `/reports/blocked-escalated` for this reason. The heading above this panel
 * says so in as many words.
 *
 * The escalated half comes from the report, which already restricts the flag
 * to tickets that are still OPEN, IN_PROGRESS or BLOCKED (decision D10) — a
 * ticket that was escalated and has since been closed keeps the flag as
 * history and needs nobody's attention. The unassigned half is an ordinary
 * `GET /incidents` query for open unowned tickets, oldest first, with the
 * twenty-four-hour threshold applied here: the API has no "older than" filter,
 * and asking for the oldest page and cutting it at an age is exact, because
 * everything past the cut is younger still.
 */
export function NeedsAttentionPanel({
  escalated,
  escalatedTotal,
  unassigned,
  isPending,
  error,
  asOf,
  buildingId,
}: NeedsAttentionPanelProps) {
  const now = asOf ? new Date(asOf) : new Date();
  const stale = unassigned.filter(
    (incident) => hoursSince(incident.created_at, now) >= UNASSIGNED_HOURS,
  );

  return (
    <QueryState
      isPending={isPending}
      error={error}
      errorFallback="Could not load the tickets needing attention."
    >
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
          alignItems: 'start',
        }}
      >
        <Card>
          <CardContent>
            <PanelHeading
              icon={<ReportProblemIcon fontSize="small" color="error" />}
              title="Escalated"
              detail={
                escalatedTotal === 0
                  ? 'Nothing is escalated.'
                  : `${escalatedTotal} ticket${escalatedTotal === 1 ? '' : 's'} someone has asked for attention on.`
              }
            />

            {escalated.length === 0 ? (
              <EmptyState title="Nothing is escalated" />
            ) : (
              <Stack spacing={1.5} sx={{ mt: 2 }}>
                {escalated.slice(0, ROW_CAP).map((ticket) => (
                  <AttentionRow
                    key={ticket.incident_id}
                    incidentId={ticket.incident_id}
                    reference={ticket.reference}
                    title={ticket.title}
                    chips={
                      <>
                        <StatusChip status={ticket.status} />
                        <PriorityChip priority={ticket.priority} />
                      </>
                    }
                    detail={
                      ticket.escalation_reason
                        ? `"${ticket.escalation_reason}"`
                        : 'No reason was given.'
                    }
                    age={
                      ticket.escalated_at
                        ? `escalated ${relativeTime(ticket.escalated_at, now)}`
                        : null
                    }
                    // No group on a report row, so the dialog orders by load
                    // alone rather than by specialty match. See AssignButton.
                    groupId={null}
                  />
                ))}
                <ShowAll
                  shown={Math.min(escalated.length, ROW_CAP)}
                  total={escalatedTotal}
                  to={currentListLink(buildingId, {
                    escalatedOnly: true,
                    statuses: ACTIVE_STATUSES,
                  })}
                  noun="escalated ticket"
                />
              </Stack>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <PanelHeading
              icon={<PersonSearchIcon fontSize="small" color="warning" />}
              title={`Unassigned for over ${UNASSIGNED_HOURS} hours`}
              detail={
                stale.length === 0
                  ? 'Every open ticket has an owner, or was reported today.'
                  : `${stale.length} open ticket${stale.length === 1 ? '' : 's'} nobody has picked up.`
              }
            />

            {stale.length === 0 ? (
              <EmptyState title="Nothing has been left waiting" />
            ) : (
              <Stack spacing={1.5} sx={{ mt: 2 }}>
                {stale.slice(0, ROW_CAP).map((incident) => (
                  <AttentionRow
                    key={incident.id}
                    incidentId={incident.id}
                    reference={incident.reference}
                    title={incident.title}
                    chips={
                      <>
                        <StatusChip status={incident.status} />
                        <PriorityChip priority={incident.priority} />
                      </>
                    }
                    detail={`${incident.category.group_name ?? 'Uncategorised'} › ${incident.category.name} · ${incident.location.path}`}
                    age={`reported ${relativeTime(incident.created_at, now)}`}
                    groupId={incident.category.group_id}
                  />
                ))}
                <ShowAll
                  shown={Math.min(stale.length, ROW_CAP)}
                  total={stale.length}
                  to={currentListLink(buildingId, {
                    statuses: ['OPEN'],
                    assigneeId: 'unassigned',
                  })}
                  noun="unassigned ticket"
                />
              </Stack>
            )}
          </CardContent>
        </Card>
      </Box>
    </QueryState>
  );
}

function PanelHeading({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {icon}
        <Typography variant="h3" component="h3">
          {title}
        </Typography>
      </Box>
      <Typography variant="caption" color="text.secondary">
        {detail}
      </Typography>
    </>
  );
}

function AttentionRow({
  incidentId,
  reference,
  title,
  chips,
  detail,
  age,
  groupId,
}: {
  incidentId: string;
  reference: string;
  title: string;
  chips: ReactNode;
  detail: string;
  age: string | null;
  groupId: string | null;
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1.5,
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        pb: 1.5,
        borderBottom: 1,
        borderColor: 'divider',
        '&:last-of-type': { borderBottom: 0, pb: 0 },
      }}
    >
      <Box sx={{ minWidth: 0, flex: '1 1 240px' }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <Link
            component={RouterLink}
            to={incidentPath(incidentId)}
            underline="hover"
            sx={{ fontWeight: 600 }}
          >
            {reference}
          </Link>
          {age ? (
            <Typography variant="caption" color="text.secondary">
              {age}
            </Typography>
          ) : null}
        </Box>
        <Typography variant="body2">{title}</Typography>
        <Box sx={{ display: 'flex', gap: 1, mt: 0.75, flexWrap: 'wrap' }}>{chips}</Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {detail}
        </Typography>
      </Box>
      <AssignButton incidentId={incidentId} reference={reference} groupId={groupId} />
    </Box>
  );
}

/**
 * The line under a capped list.
 *
 * Rendered only when rows were left out, and it says how many rather than
 * offering a bare "see all": a reader who can see six of six needs no link,
 * and one who can see six of twenty-six needs to know that before they act on
 * what is in front of them.
 *
 * The link carries no dates, for the same reason the tiles above it do not —
 * the number it stands behind was never windowed. See `listLinks.ts`.
 */
function ShowAll({
  shown,
  total,
  to,
  noun,
}: {
  shown: number;
  total: number;
  to: string;
  noun: string;
}) {
  if (total <= shown) {
    return null;
  }
  return (
    <Typography variant="body2" sx={{ pt: 0.5 }}>
      <Link component={RouterLink} to={to} underline="hover">
        Show all {total} {noun}
        {total === 1 ? '' : 's'}
      </Link>
    </Typography>
  );
}

/** Whole and fractional hours between a timestamp and a moment. */
function hoursSince(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / 3_600_000;
}
