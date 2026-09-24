import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';

import type { EngineerWorkload } from '../../api/reports';
import { EmptyState } from '../../components/QueryState';
import { useRowNavigation } from '../../components/rowNavigation';
import { availabilityLabel } from '../../display/labels';
import { engineerPath } from '../../routes';
import { levelLabel } from '../../layout/roleLabels';
import { CapacityBar } from '../engineers/CapacityBar';
import { paths } from '../../routes';

export interface EngineerWorkloadTableProps {
  engineers: EngineerWorkload[];
  /** Carried into the per-engineer links so the list matches the row. */
  periodFrom: string | undefined;
  periodTo: string | undefined;
  buildingId: string;
  isStale?: boolean;
}

/**
 * Who is holding what, and what they finished.
 *
 * **This table mixes two scopes and says which is which in its own header.**
 * The four load columns are a snapshot of now — "how busy is this person" is a
 * question about today, and the API computes them without any date term — while
 * "Resolved" alone counts tickets whose `resolved_at` falls inside the selected
 * period. Putting the period in that one column's header, rather than in a
 * footnote, is what stops a reader carrying the date range across the whole row.
 *
 * **The row opens the engineer's page; the two links on the right keep their
 * own destinations.** The capacity bar goes to that person's live queue and the
 * resolved count to the tickets behind that number, the latter carrying the
 * same dates the column was computed over so the list and the number agree.
 * Both are anchors, which is exactly what the row's click handler declines to
 * act on — see `components/rowNavigation.ts`. The name stays a link too, so
 * the row is reachable without a pointer.
 */
export function EngineerWorkloadTable({
  engineers,
  periodFrom,
  periodTo,
  buildingId,
  isStale = false,
}: EngineerWorkloadTableProps) {
  const openRow = useRowNavigation();

  if (engineers.length === 0) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            title="No engineers yet"
            description="Add engineers from the Engineers screen and their load will appear here."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card sx={{ opacity: isStale ? 0.55 : 1, transition: 'opacity 150ms' }}>
      <CardContent>
        <Typography variant="h3" component="h3">
          Engineer workload
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Load is live; only the last column covers the selected period.
        </Typography>

        {/* Horizontal scroll rather than dropping columns on a phone: every
            column here is a number an admin compares across rows, and a table
            that hides three of them at 375px answers a different question. */}
        <Box sx={{ overflowX: 'auto', mt: 2 }}>
          <Table size="small" aria-label="Engineer workload">
            <TableHead>
              <TableRow>
                <TableCell>Engineer</TableCell>
                <TableCell>Level</TableCell>
                <TableCell>Availability</TableCell>
                <TableCell align="right">Open</TableCell>
                <TableCell align="right">In progress</TableCell>
                <TableCell align="right">Blocked</TableCell>
                <TableCell sx={{ minWidth: 140 }}>Capacity now</TableCell>
                <TableCell align="right" sx={{ minWidth: 120 }}>
                  Resolved
                  <Typography variant="caption" color="text.secondary" component="span" sx={{ display: 'block' }}>
                    in the period
                  </Typography>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {engineers.map((engineer) => (
                <TableRow
                  key={engineer.user_id}
                  hover
                  onClick={(event) => openRow(event, engineerPath(engineer.user_id))}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {/*
                      §6.1: the name goes to the person, not to a filtered
                      list. It used to open their queue, which answered "what
                      are they holding" and nothing else — their page answers
                      that *and* what they have got through, and carries the
                      link to the queue itself.
                    */}
                    <Link
                      component={RouterLink}
                      to={engineerPath(engineer.user_id)}
                      underline="hover"
                    >
                      {engineer.full_name}
                    </Link>
                  </TableCell>
                  <TableCell>{levelLabel(engineer.level)}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={availabilityLabel(engineer.availability)}
                      color={engineer.availability === 'AVAILABLE' ? 'success' : 'default'}
                    />
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {engineer.open_count}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {engineer.in_progress_count}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {engineer.blocked_count}
                  </TableCell>
                  <TableCell>
                    {/*
                      The queue link moved here from the name, which now goes
                      to the engineer's page. It belongs on the bar anyway: the
                      bar *is* the active count, and every other number on this
                      dashboard opens the list it counted.
                    */}
                    <Link
                      component={RouterLink}
                      to={queueLink(engineer.user_id, buildingId)}
                      underline="none"
                      aria-label={`${engineer.full_name}'s current queue`}
                      sx={{ display: 'block' }}
                    >
                      <CapacityBar
                        active={engineer.active_count}
                        max={engineer.max_active_tickets}
                      />
                    </Link>
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    <Link
                      component={RouterLink}
                      to={resolvedLink(engineer.user_id, buildingId, periodFrom, periodTo)}
                      underline="hover"
                    >
                      {engineer.resolved_in_period}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </CardContent>
    </Card>
  );
}

/**
 * This engineer's live queue.
 *
 * No dates: the columns it stands behind are a snapshot of now, so a link that
 * windowed them would open a shorter list than the number beside it.
 */
function queueLink(userId: string, buildingId: string): string {
  const params = new URLSearchParams({ assignee_id: userId });
  for (const status of ['OPEN', 'IN_PROGRESS', 'BLOCKED']) {
    params.append('status', status);
  }
  if (buildingId) {
    params.set('building_id', buildingId);
  }
  return `${paths.allTickets}?${params.toString()}`;
}

/**
 * What this engineer resolved in the period.
 *
 * An approximation, and the only one on this dashboard: `GET /incidents`
 * filters on `created_at`, not on `resolved_at`, so this opens the tickets
 * assigned to them that were *reported* in the period and have since been
 * resolved or closed. For a period longer than the typical time-to-resolve the
 * two sets are nearly the same; for a short one they are not. The chip above
 * the list names the dates it applied, so the difference is visible rather than
 * silent. Closing the gap properly needs a `resolved_from`/`resolved_to` filter
 * on the incidents endpoint — recorded in the deployment checklist.
 */
function resolvedLink(
  userId: string,
  buildingId: string,
  from: string | undefined,
  to: string | undefined,
): string {
  const params = new URLSearchParams({ assignee_id: userId });
  for (const status of ['RESOLVED', 'CLOSED']) {
    params.append('status', status);
  }
  if (buildingId) {
    params.set('building_id', buildingId);
  }
  if (from) {
    params.set('created_from', from);
  }
  if (to) {
    params.set('created_to', to);
  }
  return `${paths.allTickets}?${params.toString()}`;
}
