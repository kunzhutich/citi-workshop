import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { Link as RouterLink, useParams } from 'react-router-dom';

import { LevelChip } from '../../components/LevelChip';
import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import { availabilityLabel } from '../../display/labels';
import { paths } from '../../routes';
import { BreakdownChart } from '../dashboard/BreakdownChart';
import { DashboardFilterBar } from '../dashboard/DashboardFilterBar';
import { useEngineerDetailReport } from '../dashboard/hooks';
import { PeriodScopeHeading } from '../dashboard/ScopeHeading';
import { StatTile, StatTileGrid } from '../dashboard/StatTile';
import { useDashboardFilters } from '../dashboard/useDashboardFilters';
import { HomeTicketRow } from '../home/HomeTicketRow';
import { useIncidents } from '../incidents/hooks';
import { CapacityBar } from './CapacityBar';
import { EngineerBasics } from './EngineerBasics';
import { useEngineer } from './hooks';

/** How many of their current tickets the page lists before deferring. */
const CURRENT_LIMIT = 8;

/**
 * One engineer's page — §6.1 of the redesign brief.
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
 * **The period applies to the figures, not to the current work.** "What are
 * they holding right now" is a question about today — the same split the admin
 * dashboard is built around (D9), and the same reason this page has a period
 * heading over one half and not the other.
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
            <PageHeader
              title={engineer.data.full_name}
              description={engineer.data.email}
              actions={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                  <LevelChip level={engineer.data.level} />
                  <Typography variant="body2" color="text.secondary">
                    {availabilityLabel(engineer.data.availability)}
                  </Typography>
                  <CapacityBar
                    active={engineer.data.active_ticket_count}
                    max={engineer.data.max_active_tickets}
                  />
                </Box>
              }
            />

            {!engineer.data.is_active ? (
              <Alert severity="warning" sx={{ mb: 2 }}>
                This account is deactivated. They cannot sign in, and their history stays.
              </Alert>
            ) : null}

            <EngineerBasics engineer={engineer.data} />

            {/* --- The period half ------------------------------------------ */}

            <DashboardFilterBar
              controls={controls}
              note="The dates apply to the figures below. What they are holding right now is
                    counted however old it is."
            />

            <PeriodScopeHeading
              title="What they got through"
              from={reportWindow?.from}
              to={reportWindow?.to}
              buildingName={null}
            />

            <QueryState
              isPending={report.isPending}
              error={report.error}
              errorFallback="Could not load this engineer's figures."
            >
              <StatTileGrid>
                <StatTile
                  label="Resolved"
                  value={report.data?.resolved_in_period ?? 0}
                  caption="Tickets they marked fixed in this period"
                />
                <StatTile
                  label="Closed"
                  value={report.data?.closed_in_period ?? 0}
                  caption="Of those, agreed finished by the reporter or an admin"
                />
                <StatTile
                  label="Resolved, then reopened"
                  value={report.data?.reopened_in_period ?? 0}
                  caption={
                    report.data?.reopen_rate_pct === null || report.data === undefined
                      ? 'Nothing resolved in this period'
                      : `${report.data.reopen_rate_pct}% of what they resolved came back`
                  }
                />
              </StatTileGrid>

              <Box sx={{ mt: 3 }}>
                <BreakdownChart
                  title="What they fix"
                  caption="Resolved in this period, by category group"
                  emptyMessage="Nothing resolved in this period"
                  isStale={report.isFetching}
                  data={(report.data?.resolved_by_group ?? []).map((row) => ({
                    key: row.group_id,
                    label: row.group_name,
                    value: row.count,
                    // Straight to the tickets the bar counted, filtered the
                    // same way the number was.
                    href: `${paths.allTickets}?assignee_id=${userId}&group_id=${row.group_id}`,
                  }))}
                />
              </Box>
            </QueryState>

            {/* --- The right-now half --------------------------------------- */}

            <Box sx={{ mt: 4 }}>
              <Typography variant="h2" component="h2" gutterBottom>
                On their plate now
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Everything open, in progress or blocked that is assigned to them — whenever it
                was reported. The dates above do not reach it.
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
                    {(current.data?.total ?? 0) > CURRENT_LIMIT ? (
                      <Button
                        component={RouterLink}
                        to={`${paths.allTickets}?assignee_id=${userId}`}
                        size="small"
                        sx={{ justifySelf: 'start' }}
                      >
                        See all {current.data?.total} assigned
                      </Button>
                    ) : null}
                  </Box>
                )}
              </QueryState>
            </Box>
          </>
        ) : null}
      </QueryState>
    </Box>
  );
}
