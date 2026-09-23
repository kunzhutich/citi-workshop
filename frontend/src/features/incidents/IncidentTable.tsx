import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import { Link as RouterLink } from 'react-router-dom';

import type { IncidentListItem } from '../../api/types';
import { EscalatedFlag } from '../../components/EscalatedFlag';
import { PriorityChip } from '../../components/PriorityChip';
import { StatusChip } from '../../components/StatusChip';
import { relativeTime } from '../../display/time';
import { incidentPath } from '../../routes';

/**
 * The desktop list of tickets.
 *
 * A plain Material UI `Table` rather than `@mui/x-data-grid`. The grid was the
 * build plan's suggestion and would have brought column resizing, density and
 * virtualisation — none of which this list needs, against a package comparable
 * in size to the rest of the application, on a bundle the M5 notes already
 * flag as one to watch.
 *
 * What the list *does* need is a second rendering for phones, which is
 * `IncidentCardList`. Both read the same rows from the same hook, so a column
 * added here has an obvious place to appear there.
 *
 * Sorting is server-side: the header writes `sort` into the URL and the API
 * orders the query. Sorting the 25 rows on screen would silently sort a page
 * rather than a list, which is the kind of wrong that looks right.
 */

/** Columns the API can sort by, and the parameter each one sends. */
const SORTABLE = {
  ticket_number: 'ticket_number',
  priority: 'priority',
  created_at: 'created_at',
  updated_at: 'updated_at',
} as const;

type SortableColumn = keyof typeof SORTABLE;

export interface IncidentTableProps {
  incidents: IncidentListItem[];
  sort: string;
  onSortChange: (sort: string) => void;
}

export function IncidentTable({ incidents, sort, onSortChange }: IncidentTableProps) {
  const descending = sort.startsWith('-');
  const sortedBy = descending ? sort.slice(1) : sort;

  /** Toggle direction on the active column, or switch to a new one. */
  const changeSort = (column: SortableColumn) => {
    const field = SORTABLE[column];
    if (sortedBy !== field) {
      // Time and priority read most usefully highest-first; a ticket number
      // reads most usefully lowest-first.
      onSortChange(field === 'ticket_number' ? field : `-${field}`);
      return;
    }
    onSortChange(descending ? field : `-${field}`);
  };

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small" aria-label="Tickets">
        <TableHead>
          <TableRow>
            <SortableHeader
              column="ticket_number"
              label="Ticket"
              sortedBy={sortedBy}
              descending={descending}
              onSort={changeSort}
            />
            <TableCell>Title</TableCell>
            <TableCell>Status</TableCell>
            <SortableHeader
              column="priority"
              label="Priority"
              sortedBy={sortedBy}
              descending={descending}
              onSort={changeSort}
            />
            <TableCell>Category</TableCell>
            <TableCell>Location</TableCell>
            <TableCell>Assignee</TableCell>
            <SortableHeader
              column="updated_at"
              label="Updated"
              sortedBy={sortedBy}
              descending={descending}
              onSort={changeSort}
            />
          </TableRow>
        </TableHead>
        <TableBody>
          {incidents.map((incident) => (
            <TableRow key={incident.id} hover>
              <TableCell>
                <Link
                  component={RouterLink}
                  to={incidentPath(incident.id)}
                  sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}
                >
                  {incident.reference}
                </Link>
              </TableCell>
              <TableCell sx={{ maxWidth: 320 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" noWrap title={incident.title}>
                    {incident.title}
                  </Typography>
                  {incident.is_escalated ? <EscalatedFlag /> : null}
                </Box>
              </TableCell>
              <TableCell>
                <StatusChip status={incident.status} />
              </TableCell>
              <TableCell>
                <PriorityChip priority={incident.priority} />
              </TableCell>
              <TableCell>
                <Typography variant="body2" noWrap>
                  {incident.category.group_name ? `${incident.category.group_name} › ` : ''}
                  {incident.category.name}
                </Typography>
              </TableCell>
              <TableCell>
                <Typography variant="body2" noWrap>
                  {incident.location.path}
                </Typography>
              </TableCell>
              <TableCell>
                <Typography variant="body2" noWrap color={incident.assignee ? undefined : 'text.secondary'}>
                  {incident.assignee?.full_name ?? 'Unassigned'}
                </Typography>
              </TableCell>
              <TableCell>
                <Typography variant="body2" noWrap>
                  {relativeTime(incident.updated_at)}
                </Typography>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

interface SortableHeaderProps {
  column: SortableColumn;
  label: string;
  sortedBy: string;
  descending: boolean;
  onSort: (column: SortableColumn) => void;
}

function SortableHeader({ column, label, sortedBy, descending, onSort }: SortableHeaderProps) {
  const active = sortedBy === SORTABLE[column];
  return (
    <TableCell sortDirection={active ? (descending ? 'desc' : 'asc') : false}>
      <TableSortLabel
        active={active}
        direction={active && descending ? 'desc' : 'asc'}
        onClick={() => onSort(column)}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );
}
