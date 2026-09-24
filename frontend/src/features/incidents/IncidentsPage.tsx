import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TablePagination from '@mui/material/TablePagination';
import Typography from '@mui/material/Typography';
import { useEffect, useRef } from 'react';
import { Link as RouterLink } from 'react-router-dom';

import type { IncidentQuery } from '../../api/incidents';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState, QueryState } from '../../components/QueryState';
import { useAuth } from '../../auth/AuthContext';
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
  /**
   * Start an employee on their own building, once, when they arrive with no
   * filters of their own.
   *
   * §5.4, and only All Tickets asks for it. An employee opening "every
   * incident" is almost always checking whether their problem is already
   * reported, and a problem is somewhere — the building they are standing in.
   */
  defaultToOwnBuilding?: boolean;
  /**
   * Render as a section of a larger page rather than as the screen itself.
   *
   * The one thing it changes is the heading. `PageHeader` renders an `h1` by
   * construction — that is its whole job, "one `h1` per page, in the same
   * place" — and the engineer page already has one, its subject's name. Two
   * `h1`s in one document is an accessibility defect, and **not one the axe
   * scan would have reported**: `e2e/accessibility.spec.ts` filters to the
   * `wcag2a`/`wcag2aa` tags, the only rule about this is the best-practice
   * `page-has-heading-one`, and that one complains about *none* rather than
   * about two. So an embedded list titles itself with an `h2` instead, and
   * keeps the title and description props doing the same job they do on a
   * screen of their own.
   *
   * A boolean rather than a heading level, because the level is not really the
   * question: a list that is not the page must not use `PageHeader` at all,
   * and every page in this application nests its sections exactly one deep.
   *
   * Everything else — the filter bar, the paging, the table and card list, the
   * empty state — is deliberately untouched. Those are the reason to reuse
   * this component instead of building a second ticket table.
   */
  embedded?: boolean;
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
  defaultToOwnBuilding = false,
  embedded = false,
}: IncidentsPageProps) {
  const { isMobile } = useBreakpoint();
  const { user } = useAuth();
  const controls = useIncidentFilters();

  /*
   * The default building, applied to the URL rather than to the query.
   *
   * Writing it into the address bar is what makes it a *default* instead of a
   * hidden rule: the filter bar shows it, `AppliedFilterChips` can remove it,
   * the view is still the bookmarkable thing BUILD-PLAN §10 asks for, and a
   * link somebody sends means what it says.
   *
   * `applied` is a ref rather than a condition on the filters, because the
   * obvious condition — "no building chosen" — is also true the moment the
   * employee clears the filter, and the page would put it straight back.
   * Once per mount, then never again.
   */
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current) {
      return;
    }
    applied.current = true;

    const ownBuilding = user?.last_building_id ?? null;
    if (
      defaultToOwnBuilding &&
      ownBuilding !== null &&
      user?.role === 'EMPLOYEE' &&
      controls.activeCount === 0
    ) {
      controls.setFilters({ buildingId: ownBuilding });
    }
    // Deliberately once, on mount. See `applied`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      {embedded ? (
        <Box sx={{ mb: 3 }}>
          <Typography variant="h2" component="h2">
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: '72ch' }}>
            {description}
          </Typography>
        </Box>
      ) : (
        <PageHeader title={title} description={description} />
      )}

      {/* The preset goes to the bar as well as to the query. A control over a
          value this screen already fixes would write the URL and change
          nothing, because `toQuery` applies the preset last on purpose — see
          `fixedByPreset`. */}
      <IncidentFilterBar controls={controls} preset={preset} />

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
