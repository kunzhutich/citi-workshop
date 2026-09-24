import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import { Link as RouterLink, useParams } from 'react-router-dom';

import { LevelChip } from '../../components/LevelChip';
import { QueryState } from '../../components/QueryState';
import { availabilityLabel } from '../../display/labels';
import { paths } from '../../routes';
import { BreakdownChart } from '../dashboard/BreakdownChart';
import { DashboardFilterBar } from '../dashboard/DashboardFilterBar';
import { useEngineerDetailReport } from '../dashboard/hooks';
import { PeriodScopeHeading, ScopeLabel } from '../dashboard/ScopeHeading';
import { StatTile, StatTileGrid } from '../dashboard/StatTile';
import { useDashboardFilters } from '../dashboard/useDashboardFilters';
import { HomeTicketRow } from '../home/HomeTicketRow';
import { useIncidents } from '../incidents/hooks';
import { IncidentsPage } from '../incidents/IncidentsPage';
import { CapacityBar } from './CapacityBar';
import { EngineerBasics } from './EngineerBasics';
import { useEngineer } from './hooks';

/** How many of their current tickets the right-hand column lists. */
const CURRENT_LIMIT = 8;

/**
 * Narrowest a half may be before the two of them stop sharing a line.
 *
 * A flex basis rather than a breakpoint, deliberately. D44 is the entry about
 * a layout switched on the *window's* width while the box holding it was 248px
 * of drawer and 48px of padding narrower — this asks the box instead, so the
 * columns split when there is room for them and stack when there is not,
 * whatever the window is doing around them.
 */
const HALF_BASIS = 340;

/**
 * One engineer's page — §6.1 of the redesign brief, rearranged in R7.
 *
 * It replaces an "Edit engineer" modal, and the difference is not that a page
 * is bigger than a dialog. A dialog can only answer *what are this person's
 * settings*; the question anybody actually arrives with is **how are they
 * doing** — what have they fixed, what is on their plate, and how much of
 * their work came back. Those need a period, a chart and a list, none of which
 * fit in a modal and all of which the API could already nearly answer.
 *
 * **The reopen figure is the point of the page, and it is a careful number.**
 * It counts tickets this engineer resolved in the window that carry a reopen —
 * not tickets reopened *because their fix failed*, which would need the event
 * log walked to find whose RESOLVED each REOPENED followed. The screen says
 * "resolved, then reopened" for exactly that reason, and the tooltip says the
 * rest. A quality signal that overstates itself is worse than none.
 *
 * **The period applies to the figures, not to the current work**, which is
 * D9's rule and the thing this layout has to keep visible. The page used to
 * rely on a sentence under the filter bar saying so. It now says it the way
 * the admin dashboard does (D14): two scope labels, one over each half —
 * "Right now" over the capacity bar and the live queue, "Over the selected
 * period" over the tiles and the chart — and the date controls sit inside the
 * period heading rather than above the whole page, so they cannot look like
 * they reach the half above them.
 *
 * **The ticket table at the bottom is `IncidentsPage` with a preset**, the
 * same component the four list screens are. It brings its own filter bar,
 * paging and empty state, which is the entire reason to reuse it; `embedded`
 * is the one thing it is told, and all that does is stop it claiming the
 * page's `h1`. Its scope is a third one — every ticket ever assigned to this
 * person, finished work last — so its own description says so rather than
 * letting the period label above it be read over it.
 */
export function EngineerDetailPage() {
  const { userId = '' } = useParams();
  const controls = useDashboardFilters();
  const { periodParams } = controls;

  const engineer = useEngineer(userId);
  const report = useEngineerDetailReport(userId, periodParams);

  // Their live queue, unscoped by the period on purpose.
  const current = useIncidents({
    assignee_id: userId,
    status: ['OPEN', 'IN_PROGRESS', 'BLOCKED'],
    sort: '-priority',
    page_size: CURRENT_LIMIT,
  });

  const reportWindow = report.data?.window;
  const currentTotal = current.data?.total ?? 0;

  return (
    <Box>
      <Button
        component={RouterLink}
        to={paths.engineers}
        startIcon={<ArrowBackIcon />}
        sx={{ mb: 2, ml: -1 }}
      >
        Engineers
      </Button>

      <QueryState
        isPending={engineer.isPending}
        error={engineer.error}
        errorFallback="Could not load this engineer."
      >
        {engineer.data ? (
          <>
            {/*
              The page's own `h1`, rather than `PageHeader`.
              `PageHeader.title` is a string by construction, and the level
              belongs *inside* the title line — "Priya Raman, Lead" is one
              fact about one person, where a chip at the far end of the header
              row reads as a control for the screen. `TicketTitle`'s `page`
              density is the same exception for the same reason.
            */}
            <Box sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography variant="h1" component="h1">
                  {engineer.data.full_name}
                </Typography>
                <LevelChip level={engineer.data.level} />
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {engineer.data.email}
              </Typography>
            </Box>

            {!engineer.data.is_active ? (
              <Alert severity="warning" sx={{ mb: 2 }}>
                This account is deactivated. They cannot sign in, and their history stays.
              </Alert>
            ) : null}

            {/* --- Their settings, and what they are holding ---------------- */}

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'flex-start' }}>
              <Box sx={{ flex: `1 1 ${HALF_BASIS}px`, minWidth: 0 }}>
                <EngineerBasics engineer={engineer.data} />
              </Box>

              <Box sx={{ flex: `1 1 ${HALF_BASIS}px`, minWidth: 0 }}>
                <ScopeLabel kind="current" />

                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 2,
                    mb: 3,
                  }}
                >
                  <CapacityBar
                    active={engineer.data.active_ticket_count}
                    max={engineer.data.max_active_tickets}
                  />
                  <Typography variant="body2" color="text.secondary">
                    {availabilityLabel(engineer.data.availability)}
                  </Typography>
                </Box>

                <Typography variant="h3" component="h2">
                  On their plate now
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mb: 1 }}
                >
                  Open, in progress or blocked — however long ago it was reported.
                </Typography>

                <QueryState
                  isPending={current.isPending}
                  error={current.error}
                  errorFallback="Could not load their current tickets."
                >
                  {(current.data?.items.length ?? 0) === 0 ? (
                    <Alert severity="info">Nothing is assigned to them right now.</Alert>
                  ) : (
                    <Box sx={{ display: 'grid', gap: 1.5 }}>
                      {(current.data?.items ?? []).map((incident) => (
                        <HomeTicketRow key={incident.id} incident={incident} />
                      ))}
                      {currentTotal > CURRENT_LIMIT ? (
                        /*
                         * A sentence where there used to be a link to
                         * `/tickets?assignee_id=…`. That link now sends a
                         * reader off the page to reach a table that is four
                         * hundred pixels below them.
                         */
                        <Typography variant="caption" color="text.secondary">
                          The {CURRENT_LIMIT} most urgent of {currentTotal}. Every ticket they
                          have ever had, finished work included, is in the table below.
                        </Typography>
                      ) : null}
                    </Box>
                  )}
                </QueryState>
              </Box>
            </Box>

            {/* --- What they got through, over the chosen period ------------ */}

            <PeriodScopeHeading
              title="What they got through"
              // Still read off the response rather than the picker, even
              // though `datesShownElsewhere` means no reader sees them: the
              // day this heading shows its dates again, they must be the
              // server's own. See D14 and D24.
              from={reportWindow?.from}
              to={reportWindow?.to}
              buildingName={null}
              datesShownElsewhere
              /*
               * `note={false}` and not a shorter sentence. The bar's caption
               * exists on the dashboard because nothing else there says which
               * widgets the dates reach; here the two scope labels say it
               * structurally, above the things they are about, and a third
               * statement of it would be the line nobody reads.
               */
              actions={<DashboardFilterBar controls={controls} note={false} />}
            />

            <QueryState
              isPending={report.isPending}
              error={report.error}
              errorFallback="Could not load this engineer's figures."
            >
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'stretch' }}>
                {/* Two fifths and three fifths when they share a line, one
                    above the other when they cannot. The grow factors are
                    what make the split uneven; the bases are what decide
                    when it stops being a split at all. */}
                <Box sx={{ flex: '1 1 250px', minWidth: 0 }}>
                  <StatTileGrid stack>
                    <StatTile
                      label="Resolved"
                      value={report.data?.resolved_in_period ?? 0}
                      caption="Tickets they marked fixed in this period"
                      isStale={report.isFetching}
                    />
                    <StatTile
                      label="Closed"
                      value={report.data?.closed_in_period ?? 0}
                      caption="Of those, agreed finished by the reporter or an admin"
                      isStale={report.isFetching}
                    />
                    <StatTile
                      label="Resolved, then reopened"
                      value={report.data?.reopened_in_period ?? 0}
                      caption={
                        report.data?.reopen_rate_pct === null || report.data === undefined
                          ? 'Nothing resolved in this period'
                          : `${report.data.reopen_rate_pct}% of what they resolved came back`
                      }
                      isStale={report.isFetching}
                    />
                  </StatTileGrid>
                </Box>

                <Box sx={{ flex: '1.7 1 360px', minWidth: 0 }}>
                  <BreakdownChart
                    title="What they fix"
                    caption="Resolved in this period, by category group"
                    emptyMessage="Nothing resolved in this period"
                    isStale={report.isFetching}
                    /*
                     * A pie, as §D3 of the brief asks. It is worth recording
                     * that this is the one chart on the application whose
                     * shape the palette does not endorse: D57 caps a pie at
                     * the three categorical slice colours that clear the
                     * all-pairs gates, and there are eight category groups.
                     * No colour is passed, so every slice is the one series
                     * colour `chartPalette.ts` prescribes for a many-category
                     * breakdown — which means the legend names eight shares
                     * that nothing on the arc distinguishes. The table toggle
                     * in the card's own header is what makes it readable, and
                     * bars are what would make it legible.
                     */
                    shape="pie"
                    data={(report.data?.resolved_by_group ?? []).map((row) => ({
                      key: row.group_id,
                      label: row.group_name,
                      value: row.count,
                      // Straight to the tickets the slice counted, filtered
                      // the same way the number was.
                      href: `${paths.allTickets}?assignee_id=${userId}&group_id=${row.group_id}`,
                    }))}
                  />
                </Box>
              </Box>
            </QueryState>

            {/* --- Every ticket they have had ------------------------------- */}

            <Divider sx={{ mt: 5, mb: 3 }} />

            <IncidentsPage
              embedded
              title="Their tickets"
              description="Everything ever assigned to them, finished work last. This list has
                           its own filters and its own paging; the date range above does not
                           reach it."
              // The same shape as My Queue, pointed at somebody else: §5.6's
              // `closed_last` is a prefix to whatever sort is applied, so
              // finished work sinks however the list is arranged.
              preset={{ assignee_id: userId, closed_last: true }}
              emptyTitle="Nothing has ever been assigned to them"
              emptyDescription="Work assigned to them by a lead or an admin appears here."
            />
          </>
        ) : null}
      </QueryState>
    </Box>
  );
}
