import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';

import type { BlockedGroup } from '../../api/reports';
import { EmptyState } from '../../components/QueryState';
import { blockedReasonLabel } from '../../display/labels';
import { formatHours } from '../../display/time';
import { paths } from '../../routes';

export interface BlockedByReasonPanelProps {
  groups: BlockedGroup[];
  total: number;
  buildingId: string;
}

/**
 * Blocked tickets, grouped by what they are waiting on.
 *
 * A table rather than a chart, and deliberately. There are at most five reason
 * types, and the thing an admin needs from this widget is not the shape of the
 * distribution — it is *how long* each group has been stuck, which is two more
 * numbers per row. Five rows of three numbers is a table; drawing it as a bar
 * chart would show one of the three and hide the two that matter.
 *
 * **Ages are the point.** A ticket blocked on a part that never arrived is the
 * row worth finding, and it is precisely the row a thirty-day window would
 * drop — which is why `/reports/blocked-escalated` is not windowed at all
 * (decision D9). The age runs from when the ticket last entered BLOCKED, not
 * from when it was reported, so a ticket raised in March and blocked yesterday
 * reads as one day.
 *
 * The rows cannot link to a *reason-filtered* list, because `GET /incidents`
 * has no `blocked_reason_type` filter; they link to the blocked list for the
 * current building instead, which is the widest honest target.
 */
export function BlockedByReasonPanel({ groups, total, buildingId }: BlockedByReasonPanelProps) {
  const blockedListHref = () => {
    const params = new URLSearchParams({ status: 'BLOCKED' });
    if (buildingId) {
      params.set('building_id', buildingId);
    }
    return `${paths.allTickets}?${params.toString()}`;
  };

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="h3" component="h3">
          Blocked, by reason
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {total === 0
            ? 'Nothing is blocked.'
            : `${total} ticket${total === 1 ? '' : 's'} stuck right now. Age is measured from when each one was blocked.`}
        </Typography>

        {groups.length === 0 ? (
          <EmptyState title="Nothing is blocked" />
        ) : (
          <Box sx={{ overflowX: 'auto', mt: 2 }}>
            <Table size="small" aria-label="Blocked tickets by reason">
              <TableHead>
                <TableRow>
                  <TableCell>Waiting on</TableCell>
                  <TableCell align="right">Tickets</TableCell>
                  <TableCell align="right">Average age</TableCell>
                  <TableCell align="right">Longest</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {groups.map((group) => (
                  <TableRow key={group.blocked_reason_type ?? 'unstated'} hover>
                    <TableCell>
                      <Link component={RouterLink} to={blockedListHref()} underline="hover">
                        {group.blocked_reason_type
                          ? blockedReasonLabel(group.blocked_reason_type)
                          : 'Reason not recorded'}
                      </Link>
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {group.count}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatHours(group.average_age_hours)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatHours(group.max_age_hours)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

