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
import { useRowNavigation } from '../../components/rowNavigation';
import { StatusChip } from '../../components/StatusChip';
import { relativeTime } from '../../display/time';
import { TicketTitle } from '../../components/TicketTitle';
import { useAuth } from '../../auth/AuthContext';
import { engineerPath, incidentPath } from '../../routes';
import { useTicketLinkState } from './backTarget';

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

/**
 * How much room each column gets.
 *
 * The table is laid out `fixed` rather than letting the browser size columns
 * to their content. With `auto`, one long category — "Building & Facilities >
 * Temperature/HVAC" — widened its column until Assignee and Updated were
 * pushed off the right-hand edge of a 1440px screen, scrolling inside the
 * container where nobody would look for them.
 *
 * Title takes whatever is left, which is why it has no entry here. Everything
 * else truncates with its full value in a `title` attribute.
 */
const COLUMN_WIDTHS = {
  ticket: 105,
  // Both chip columns are now the chip's pinned width plus a cell's 16px of
  // padding each side, and nothing more. They used to be sized against the
  // longest *word* — "In progress" clipped to "In progre…" at 110 — and the
  // priority column carried extra slack for an icon the redesign removed.
  // `UniformChip` makes the width a constant, so the column can be one too,
  // and the room that frees goes to the title, which is what the escalation
  // flag now shares a cell with.
  status: 92 + 32,
  priority: 76 + 32,
  category: 175,
  location: 125,
  assignee: 120,
  updated: 100,
} as const;

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
  const ticketLinkState = useTicketLinkState();
  const { user } = useAuth();
  const isStaff = user?.role === 'ENGINEER' || user?.role === 'FACILITY_ADMIN';
  // The whole row opens the ticket — §5.5. Why a click handler rather than
  // the cards' stretched link, and which clicks it declines, is documented
  // once in `components/rowNavigation.ts`; this was the first table to want
  // it and is no longer the only one.
  const openRow = useRowNavigation();

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
      <Table size="small" aria-label="Tickets" sx={{ tableLayout: 'fixed', minWidth: 900 }}>
        <TableHead>
          <TableRow>
            <SortableHeader
              column="ticket_number"
              label="Ticket"
              width={COLUMN_WIDTHS.ticket}
              sortedBy={sortedBy}
              descending={descending}
              onSort={changeSort}
            />
            <TableCell>Title</TableCell>
            <TableCell width={COLUMN_WIDTHS.status}>Status</TableCell>
            <SortableHeader
              column="priority"
              label="Priority"
              width={COLUMN_WIDTHS.priority}
              sortedBy={sortedBy}
              descending={descending}
              onSort={changeSort}
            />
            <TableCell width={COLUMN_WIDTHS.category}>Category</TableCell>
            <TableCell width={COLUMN_WIDTHS.location}>Location</TableCell>
            <TableCell width={COLUMN_WIDTHS.assignee}>Assignee</TableCell>
            <SortableHeader
              column="updated_at"
              label="Updated"
              width={COLUMN_WIDTHS.updated}
              sortedBy={sortedBy}
              descending={descending}
              onSort={changeSort}
            />
          </TableRow>
        </TableHead>
        <TableBody>
          {incidents.map((incident) => (
            <TableRow
              key={incident.id}
              hover
              onClick={(event) =>
                openRow(event, incidentPath(incident.id), { state: ticketLinkState })
              }
              sx={{ cursor: 'pointer' }}
            >
              <TableCell>
                <Link
                  component={RouterLink}
                  to={incidentPath(incident.id)}
                  state={ticketLinkState}
                  sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}
                >
                  {incident.reference}
                </Link>
              </TableCell>
              <TableCell>
                {/* The flag leads the title rather than trailing it. Trailing, it
                    sat wherever that row's title happened to end, so a column of
                    escalated tickets had its flags scattered across the width —
                    the one thing in the row you want to find by glance was the
                    one thing with no fixed position. */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                  {incident.is_escalated ? <EscalatedFlag /> : null}
                  <TicketTitle density="row" noWrap title={incident.title}>
                    {incident.title}
                  </TicketTitle>
                </Box>
              </TableCell>
              <TableCell>
                <StatusChip status={incident.status} />
              </TableCell>
              <TableCell>
                <PriorityChip priority={incident.priority} />
              </TableCell>
              <TableCell>
                <Typography variant="body2" noWrap title={categoryPath(incident)}>
                  {categoryPath(incident)}
                </Typography>
              </TableCell>
              <TableCell>
                <Typography variant="body2" noWrap title={incident.location.path}>
                  {incident.location.path}
                </Typography>
              </TableCell>
              <TableCell>
                {/*
                  Staff get a link to whoever holds the ticket; an employee
                  gets the name as text. §5.5 is explicit that an employee must
                  not reach an engineer's profile, and this is the *courtesy*
                  half of that — `GET /reports/engineers/{id}` is `STAFF_ONLY`
                  and is what actually refuses them.
                */}
                {incident.assignee && isStaff ? (
                  <Link
                    component={RouterLink}
                    to={engineerPath(incident.assignee.id)}
                    underline="hover"
                    variant="body2"
                    noWrap
                    title={incident.assignee.full_name}
                    sx={{ display: 'block' }}
                  >
                    {incident.assignee.full_name}
                  </Link>
                ) : (
                  <Typography
                    variant="body2"
                    noWrap
                    title={incident.assignee?.full_name ?? 'Unassigned'}
                    color={incident.assignee ? undefined : 'text.secondary'}
                  >
                    {incident.assignee?.full_name ?? 'Unassigned'}
                  </Typography>
                )}
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

/** "Hardware > Monitor", or just the subcategory if the group is missing. */
function categoryPath(incident: IncidentListItem): string {
  const { group_name: group, name } = incident.category;
  return group ? `${group} \u203a ${name}` : name;
}

interface SortableHeaderProps {
  column: SortableColumn;
  label: string;
  width: number;
  sortedBy: string;
  descending: boolean;
  onSort: (column: SortableColumn) => void;
}

function SortableHeader({
  column,
  label,
  width,
  sortedBy,
  descending,
  onSort,
}: SortableHeaderProps) {
  const active = sortedBy === SORTABLE[column];
  return (
    <TableCell width={width} sortDirection={active ? (descending ? 'desc' : 'asc') : false}>
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
