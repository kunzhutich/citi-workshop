import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TablePagination from '@mui/material/TablePagination';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';

import type { IncidentQuery } from '../../api/incidents';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState, QueryState } from '../../components/QueryState';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { paths } from '../../routes';
import { useIncidents, useIncidentsInfinite } from './hooks';
import { IncidentCardList } from './IncidentCardList';
import { IncidentFilterBar } from './IncidentFilterBar';
import { IncidentTable } from './IncidentTable';
import { PAGE_SIZE, toQuery, useIncidentFilters } from './useIncidentFilters';

export interface IncidentsPageProps {
  title: string;
  description: string;
  /**
   * What this screen is for, as API filters: `{mine: 'assigned'}` for My
   * Queue, `{assignee_id: 'unassigned'}` for Unassigned. Applied after the
   * user's own filters so it cannot be filtered away.
   */
  preset?: IncidentQuery;
  /** Shown when the filtered list is empty. */
  emptyTitle: string;
  emptyDescription: string;
  /** Whether to offer "Report an issue" from the empty state. */
  offerReport?: boolean;
}

/**
 * Every list of tickets in the application, with one preset swapped out.
 *
 * My Tickets, All Tickets, My Queue and Unassigned differ in their title and
 * in one or two API filters, and in nothing else: the same filter bar, the
 * same table, the same card list, the same paging. Four components would be
 * four places to fix a column, and three of them would be noticed late.
 *
 * The two renderings are not two layouts of one component — they are a table
 * and a card list, chosen at 900px, each paging in the way that suits it.
 */
export function IncidentsPage({
  title,
  description,
  preset = {},
  emptyTitle,
  emptyDescription,
  offerReport = false,
}: IncidentsPageProps) {
  const { isMobile } = useBreakpoint();
  const controls = useIncidentFilters();
  const query = toQuery(controls.filters, preset);

  // Both hooks run on every render so their order never changes; `enabled`
  // decides which one actually issues a request.
  const paged = useIncidents(query, !isMobile);
  const accumulated = useIncidentsInfinite(query, isMobile);

  const active = isMobile ? accumulated : paged;
  const incidents = isMobile
    ? (accumulated.data?.pages.flatMap((page) => page.items) ?? [])
    : (paged.data?.items ?? []);
  const total = isMobile
    ? (accumulated.data?.pages[0]?.total ?? 0)
    : (paged.data?.total ?? 0);

  return (
    <Box>
      {/*
        No "Report an issue" button here. The shell's navigation already leads
        with one on every screen, and on a phone employees also have the FAB —
        a third copy on the list header would be the same action three times
        in one viewport. The empty state below still offers it, which is where
        it genuinely helps: "you have reported nothing yet" is the moment to
        put the button in front of someone.
      */}
      <PageHeader title={title} description={description} />

      <IncidentFilterBar controls={controls} />

      <QueryState
        isPending={active.isPending}
        error={active.error}
        errorFallback="Could not load these tickets."
      >
        {incidents.length === 0 ? (
          <EmptyState
            title={controls.activeCount > 0 ? 'No tickets match those filters' : emptyTitle}
            description={
              controls.activeCount > 0
                ? 'Try clearing a filter or searching for something else.'
                : emptyDescription
            }
            action={
              controls.activeCount > 0 ? (
                <Button variant="outlined" onClick={controls.reset}>
                  Clear filters
                </Button>
              ) : offerReport ? (
                <Button component={RouterLink} to={paths.report} variant="contained">
                  Report an issue
                </Button>
              ) : null
            }
          />
        ) : isMobile ? (
          <>
            <IncidentCardList incidents={incidents} />
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
              {accumulated.hasNextPage ? (
                <Button
                  variant="outlined"
                  onClick={() => void accumulated.fetchNextPage()}
                  loading={accumulated.isFetchingNextPage}
                >
                  Load more
                </Button>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  {total} {total === 1 ? 'ticket' : 'tickets'}
                </Typography>
              )}
            </Box>
          </>
        ) : (
          <>
            <IncidentTable
              incidents={incidents}
              sort={controls.filters.sort}
              onSortChange={(sort) => controls.setFilters({ sort })}
            />
            <TablePagination
              component="div"
              count={total}
              page={controls.filters.page - 1}
              onPageChange={(_event, page) => controls.setFilters({ page: page + 1 })}
              rowsPerPage={PAGE_SIZE}
              // The page size is fixed. Offering 10/25/50 is a control nobody
              // uses and one more thing that has to survive in the URL.
              rowsPerPageOptions={[PAGE_SIZE]}
            />
          </>
        )}
      </QueryState>
    </Box>
  );
}
