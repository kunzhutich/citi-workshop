import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

import { PageHeader } from '../../components/PageHeader';
import { QueryState } from '../../components/QueryState';
import {
  INCIDENT_PRIORITIES,
  INCIDENT_STATUSES,
  priorityLabel,
  statusLabel,
} from '../../display/labels';
import { formatHours } from '../../display/time';
import { useFacilityTree } from '../facilities/hooks';
import { useIncidents } from '../incidents/hooks';
import { BlockedByReasonPanel } from './BlockedByReasonPanel';
import { BreakdownChart, type BreakdownDatum } from './BreakdownChart';
import { PRIORITY_SLICES } from './chartPalette';
import { CommunicationPanel } from './CommunicationPanel';
import { DashboardFilterBar } from './DashboardFilterBar';
import { EngineerWorkloadTable } from './EngineerWorkloadTable';
import { FlowChart } from './FlowChart';
import {
  useBlockedEscalatedReport,
  useCategoriesReport,
  useCommunicationReport,
  useEngineerWorkloadReport,
  useLocationsReport,
  useResponseTimesReport,
  useSummaryReport,
} from './hooks';
import { ACTIVE_STATUSES, currentListLink, periodListLink } from './listLinks';
import { NeedsAttentionPanel, UNASSIGNED_HOURS } from './NeedsAttentionPanel';
import { CurrentScopeHeading, PeriodScopeHeading } from './ScopeHeading';
import { Fragment, useState, type ReactNode } from 'react';

import TuneIcon from '@mui/icons-material/Tune';

import { StatTile, StatTileGrid } from './StatTile';
import { DashboardLayoutDialog } from './DashboardLayoutDialog';
import { useDashboardLayout } from './useDashboardLayout';
import { useDashboardFilters } from './useDashboardFilters';

/** How many unowned tickets to fetch when looking for the stale ones. */
const UNASSIGNED_PAGE_SIZE = 50;

/**
 * The facility admin's dashboard.
 *
 * **The one thing to understand before changing this screen** is that it shows
 * two kinds of number under a single filter bar, and the difference is real
 * rather than cosmetic.
 *
 * * Six of the eight reports cover a **period**. Their numbers count incidents
 *   *reported between* the two dates in the filter bar, and they sit under a
 *   {@link PeriodScopeHeading} naming those dates.
 * * Two of them — `/reports/blocked-escalated` and `/reports/me` — describe the
 *   **present**. They do not accept `from`/`to` at all, because "what is
 *   blocked" is a question about now and a thirty-day window would hide the
 *   ticket that has been blocked since February. They sit under a
 *   {@link CurrentScopeHeading} that says the date range does not reach them.
 *
 * That split is decision D9 in `docs/DECISION-LOG.md`, and it was made in the
 * API precisely so that a dashboard could explain itself. The failure it was
 * raised against is a tile reading "Blocked · 21" under a "last 30 days"
 * filter when the 21 is every blocked ticket there is. Against the demo data
 * that tile would read 21 live and 11 for the period — both correct, both
 * useful, and catastrophic to confuse. So the two live in separate sections,
 * with their own headings, and no number is ever drawn under the wrong one.
 *
 * `escalated` is the sharpest case and gets a note of its own on screen: the
 * period figure counts every escalation raised on a ticket reported in the
 * period, closed ones included, while the live figure counts only tickets
 * still open, in progress or blocked (decision D10). They differ on purpose.
 */
export function AdminDashboardPage() {
  const controls = useDashboardFilters();
  const { filters, periodParams, scopeParams } = controls;

  // Which sections this admin keeps, and in what order. §5.2. `isVisible` is
  // the only thing the markup below asks — the storage, the ordering and the
  // refusal to move a section across the period/current line all live in
  // `dashboardLayout.ts`.
  const layout = useDashboardLayout();
  const [customising, setCustomising] = useState(false);

  const summary = useSummaryReport(periodParams);
  const categories = useCategoriesReport(periodParams);
  const locations = useLocationsReport(periodParams);
  const responseTimes = useResponseTimesReport(periodParams);
  const workload = useEngineerWorkloadReport(periodParams);
  const communication = useCommunicationReport(periodParams);
  const live = useBlockedEscalatedReport(scopeParams);

  // Oldest first, so everything past the age cut is younger still and one page
  // is enough to find every ticket that has been waiting over a day.
  const unassigned = useIncidents({
    assignee_id: 'unassigned',
    status: ['OPEN'],
    sort: 'created_at',
    page_size: UNASSIGNED_PAGE_SIZE,
    building_id: filters.buildingId || undefined,
  });

  const facilities = useFacilityTree();
  const buildingName =
    facilities.data?.buildings.find((building) => building.id === filters.buildingId)?.name ?? null;

  // The window the API reports back, never the one the picker shows: the two
  // agree, and reading the response is the one that cannot drift.
  // Named `reportWindow`, not `window`: a local called `window` shadows the
  // global one for the whole component, which is a trap for the next person
  // who reaches for `window.matchMedia` in here.
  const reportWindow = summary.data?.window;
  const scope = {
    from: reportWindow?.from,
    to: reportWindow?.to,
    buildingId: filters.buildingId,
  };

  const statusCount = (status: string) =>
    summary.data?.by_status.find((row) => row.status === status)?.count ?? 0;

  const resolvedInPeriod = (workload.data?.engineers ?? []).reduce(
    (running, engineer) => running + engineer.resolved_in_period,
    0,
  );

  const staleUnassignedCount = countStaleUnassigned(
    unassigned.data?.items ?? [],
    live.data?.scope.as_of,
  );

  /*
   * Each optional section as a node, looked up by the id `dashboardLayout.ts`
   * knows it by.
   *
   * A map rather than JSX in a fixed order, because the order is the admin's
   * now. The two headline tile rows and the two scope headings are *not* in
   * here: they render unconditionally, above whatever this is arranged into,
   * for the reason that file gives.
   */
  const periodSections: Record<string, ReactNode> = {
    'flow': (
      <Box sx={{ mt: 3 }}>
        <QueryState
          isPending={summary.isPending}
          error={summary.error}
          errorFallback="Could not load the daily flow."
        >
          <FlowChart perDay={summary.data?.per_day ?? []} isStale={summary.isFetching} />
        </QueryState>
      </Box>
    ),
    'breakdowns': (
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
          mt: 2,
          alignItems: 'start',
        }}
      >
        <QueryState
          isPending={summary.isPending}
          error={summary.error}
          errorFallback="Could not load the status breakdown."
        >
          <BreakdownChart
            title="By status"
            caption="Where this period's tickets stand now"
            isStale={summary.isFetching}
            emptyMessage="Nothing was reported in this period"
            data={INCIDENT_STATUSES.filter((status) => statusCount(status) > 0).map((status) => ({
              key: status,
              label: statusLabel(status),
              value: statusCount(status),
              href: periodListLink(scope, { statuses: [status] }),
            }))}
          />
        </QueryState>

        <QueryState
          isPending={summary.isPending}
          error={summary.error}
          errorFallback="Could not load the priority breakdown."
        >
          <BreakdownChart
            title="By priority"
            caption="What this period's tickets were made of"
            shape="pie"
            isStale={summary.isFetching}
            emptyMessage="Nothing was reported in this period"
            data={INCIDENT_PRIORITIES.map((priority) => ({
              key: priority,
              label: priorityLabel(priority),
              value:
                summary.data?.by_priority.find((row) => row.priority === priority)?.count ?? 0,
              href: periodListLink(scope, { priorities: [priority] }),
              // The priority chips' hues at slice steps, not the chips
              // themselves — the chip orange and the chip red are ΔE 1.9 apart
              // under deuteranopia and would be one slice. chartPalette.ts has
              // the numbers and why the chips are right to be what they are.
              color: PRIORITY_SLICES[priority],
            })).filter((datum) => datum.value > 0)}
          />
        </QueryState>

        <QueryState
          isPending={categories.isPending}
          error={categories.error}
          errorFallback="Could not load the category breakdown."
        >
          <CategoryBreakdown
            groups={categories.data?.groups ?? []}
            drillGroupId={filters.drillGroupId}
            onDrill={(groupId) => controls.setFilters({ drillGroupId: groupId })}
            scope={scope}
            isStale={categories.isFetching}
          />
        </QueryState>

        <QueryState
          isPending={locations.isPending}
          error={locations.error}
          errorFallback="Could not load the building breakdown."
        >
          <BreakdownChart
            title="By building"
            caption="Where this period's tickets came from"
            shape="pie"
            isStale={locations.isFetching}
            emptyMessage="Nothing was reported in this period"
            // No `color` per row, deliberately: buildings have no inherent
            // order and no identity a colour could follow, so the chart
            // assigns the validated categorical order itself and folds past
            // the three it clears — `foldToCategoricalSlices`. This used to
            // hand out `CATEGORICAL_SLICES[index % 3]` under a comment saying
            // it was capped at three, which the `%` made untrue: a fourth
            // building would have been painted the same blue as the first,
            // and the demo world has exactly three, so nothing would have
            // shown it.
            data={(locations.data?.buildings ?? []).map((building) => ({
              key: building.building_id,
              label: building.building_code,
              value: building.count,
              href: periodListLink(scope, { buildingId: building.building_id }),
            }))}
          />
        </QueryState>
      </Box>
    ),
    'response-times': (
      <Box sx={{ mt: 3 }}>
        <Typography variant="h3" component="h3" gutterBottom>
          How fast the team reacted
        </Typography>
        <QueryState
          isPending={responseTimes.isPending}
          error={responseTimes.error}
          errorFallback="Could not load the response times."
        >
          <StatTileGrid>
            {/*
              "Median", not "average". BUILD-PLAN section 10 says average; the
              endpoint computes percentile_cont(0.5) so that one ticket left
              over a long weekend cannot move the headline, and the label has
              to say which statistic it is showing.
            */}
            <StatTile
              label="Median time to assign"
              value={formatHours(responseTimes.data?.overall.median_assign_hours ?? null)}
              caption={overCount(responseTimes.data?.overall.assigned_count, 'assigned')}
              isStale={responseTimes.isFetching}
            />
            <StatTile
              label="Median time to acknowledge"
              value={formatHours(responseTimes.data?.overall.median_acknowledge_hours ?? null)}
              caption={overCount(responseTimes.data?.overall.acknowledged_count, 'acknowledged')}
              isStale={responseTimes.isFetching}
            />
            <StatTile
              label="Median time to resolve"
              value={formatHours(responseTimes.data?.overall.median_resolve_hours ?? null)}
              caption={overCount(responseTimes.data?.overall.resolved_count, 'resolved')}
              isStale={responseTimes.isFetching}
            />
          </StatTileGrid>
        </QueryState>
      </Box>
    ),
    /*
     * The brief's seventh business question, which had a report and no screen
     * until S1 gave it something to measure. It sits inside the period block
     * because every number on it is about activity in the window — including
     * the read rate, which counts notifications *sent* in the period rather
     * than tickets raised in it (D29). That is why it is in this map and not
     * the "right now" one: a reader can hide it, not move it across.
     */
    'communication': (
      <QueryState
        isPending={communication.isPending}
        error={communication.error}
        errorFallback="Could not load the communication figures."
      >
        <CommunicationPanel report={communication.data} isStale={communication.isFetching} />
      </QueryState>
    ),
    'workload': (
      <Box sx={{ mt: 3 }}>
        <QueryState
          isPending={workload.isPending}
          error={workload.error}
          errorFallback="Could not load the engineer workload."
        >
          <EngineerWorkloadTable
            engineers={workload.data?.engineers ?? []}
            periodFrom={reportWindow?.from}
            periodTo={reportWindow?.to}
            buildingId={filters.buildingId}
            isStale={workload.isFetching}
          />
        </QueryState>
      </Box>
    ),
  };

  const currentSections: Record<string, ReactNode> = {
    'needs-attention': (
      <NeedsAttentionPanel
        escalated={live.data?.escalated ?? []}
        escalatedTotal={live.data?.escalated_total ?? 0}
        unassigned={unassigned.data?.items ?? []}
        isPending={unassigned.isPending}
        error={unassigned.error}
        asOf={live.data?.scope.as_of}
        buildingId={filters.buildingId}
      />
    ),
    'blocked-reasons': (
      <BlockedByReasonPanel
        groups={live.data?.blocked ?? []}
        total={live.data?.blocked_total ?? 0}
        buildingId={filters.buildingId}
      />
    ),
  };

  const currentCount = layout.sections.filter(
    (section) => section.scope === 'current' && section.visible,
  ).length;

  /** The sections of one scope, in the admin's order, minus the hidden ones. */
  const arranged = (scope: 'period' | 'current', nodes: Record<string, ReactNode>) =>
    layout.sections
      .filter((section) => section.scope === scope && section.visible)
      .map((section) => <Fragment key={section.id}>{nodes[section.id]}</Fragment>);

  return (
    <Box>
      <PageHeader
        title="Dashboard"
        description="How the queue is doing, and what needs somebody today."
      />

      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <DashboardFilterBar controls={controls} />
        </Box>
        <Button
          size="small"
          startIcon={<TuneIcon />}
          onClick={() => setCustomising(true)}
          sx={{ flexShrink: 0, mt: 1 }}
        >
          Customise
        </Button>
      </Box>

      <DashboardLayoutDialog
        open={customising}
        onClose={() => setCustomising(false)}
        controls={layout}
      />

      {/* --- Period ---------------------------------------------------- */}

      <PeriodScopeHeading
        title="Reported in this period"
        from={reportWindow?.from}
        to={reportWindow?.to}
        buildingName={buildingName}
      />

      <QueryState
        isPending={summary.isPending}
        error={summary.error}
        errorFallback="Could not load the backlog summary."
      >
        <StatTileGrid>
          <StatTile
            label="Reported"
            value={summary.data?.total ?? 0}
            caption="Tickets raised in this period"
            to={periodListLink(scope)}
            isStale={summary.isFetching}
          />
          <StatTile
            label="Still open"
            value={statusCount('OPEN')}
            caption="Of those, nobody has started"
            to={periodListLink(scope, { statuses: ['OPEN'] })}
            isStale={summary.isFetching}
          />
          <StatTile
            label="Unassigned"
            value={summary.data?.unassigned_total ?? 0}
            caption="Of those, still live with no owner"
            to={periodListLink(scope, {
              statuses: ACTIVE_STATUSES,
              assigneeId: 'unassigned',
            })}
            isStale={summary.isFetching}
          />
          <StatTile
            label="Escalated"
            value={summary.data?.escalated_total ?? 0}
            caption="Of those, escalated at any point"
            to={periodListLink(scope, { escalatedOnly: true })}
            isStale={summary.isFetching}
          />
          <StatTile
            label="Resolved in the period"
            value={resolvedInPeriod}
            // No link: this counts by the day a ticket was *resolved*, and
            // `GET /incidents` can only filter on the day it was reported, so
            // any list behind it would be a different set. A missing link is
            // better than one that opens the wrong tickets.
            caption="Resolved by an engineer in this period, whenever reported"
            isStale={workload.isFetching}
          />
        </StatTileGrid>
      </QueryState>

      {arranged('period', periodSections)}

      {/* --- Right now --------------------------------------------------- */}

      <CurrentScopeHeading
        title="Right now"
        asOf={live.data?.scope.as_of}
        buildingName={buildingName}
      />

      <QueryState
        isPending={live.isPending}
        error={live.error}
        errorFallback="Could not load what is currently stuck."
      >
        <StatTileGrid>
          <StatTile
            label="Blocked"
            value={live.data?.blocked_total ?? 0}
            caption="Stuck right now, however long ago"
            to={currentListLink(filters.buildingId, { statuses: ['BLOCKED'] })}
          />
          <StatTile
            label="Escalated"
            value={live.data?.escalated_total ?? 0}
            caption="Flagged and still live"
            to={currentListLink(filters.buildingId, {
              escalatedOnly: true,
              statuses: ACTIVE_STATUSES,
            })}
          />
          <StatTile
            label={`Unassigned over ${UNASSIGNED_HOURS}h`}
            value={staleUnassignedCount}
            caption="Open, nobody has picked it up"
            to={currentListLink(filters.buildingId, {
              statuses: ['OPEN'],
              assigneeId: 'unassigned',
            })}
          />
        </StatTileGrid>

        <Alert severity="info" sx={{ mt: 2 }}>
          These three are not affected by the date range. They also do not match the
          period figures above, and should not:{' '}
          <strong>Escalated</strong> here counts only tickets that are still open, in progress
          or blocked, while the period figure counts every escalation raised on a ticket
          reported in that period — including ones that have since been closed.
        </Alert>

        <Box
          sx={{
            display: 'grid',
            gap: 2,
            // Two columns while both panels are shown, one when the admin has
            // turned one off — a lone panel in a 2fr column with empty space
            // beside it looks like something failed to load.
            gridTemplateColumns: {
              xs: '1fr',
              lg: currentCount === 2 ? '2fr 1fr' : '1fr',
            },
            mt: 2,
            alignItems: 'start',
          }}
        >
          {arranged('current', currentSections)}
        </Box>
      </QueryState>
    </Box>
  );
}

/**
 * What people reported most, with one level of drill-down.
 *
 * The top level is the category groups; clicking one replaces the chart with
 * that group's subcategories rather than opening the ticket list, which is
 * what BUILD-PLAN section 10 asks for. The drilled state lives in the URL
 * (`?group_id=`), so a subcategory breakdown is a link somebody can send.
 *
 * At the subcategory level a click does navigate, to the list filtered by that
 * subcategory — there is no third level to drill into.
 */
function CategoryBreakdown({
  groups,
  drillGroupId,
  onDrill,
  scope,
  isStale,
}: {
  groups: { group_id: string | null; group_name: string | null; count: number; subcategories: { category_id: string; category_name: string; count: number }[] }[];
  drillGroupId: string;
  onDrill: (groupId: string) => void;
  scope: { from: string | undefined; to: string | undefined; buildingId: string };
  isStale: boolean;
}) {
  const drilled = groups.find((group) => group.group_id === drillGroupId);

  if (drilled) {
    const data: BreakdownDatum[] = drilled.subcategories.map((subcategory) => ({
      key: subcategory.category_id,
      label: subcategory.category_name,
      value: subcategory.count,
      href: periodListLink(scope, { categoryId: subcategory.category_id }),
    }));

    return (
      <BreakdownChart
        title={drilled.group_name ?? 'Uncategorised'}
        caption={`Subcategories of ${drilled.group_name ?? 'this group'} in this period`}
        data={data}
        isStale={isStale}
        emptyMessage="Nothing in this group was reported in this period"
        headerAction={
          <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => onDrill('')}>
            All groups
          </Button>
        }
      />
    );
  }

  const data: BreakdownDatum[] = groups.map((group) => ({
    key: group.group_id ?? 'uncategorised',
    label: group.group_name ?? 'Uncategorised',
    value: group.count,
    href: periodListLink(scope, { groupId: group.group_id ?? undefined }),
  }));

  return (
    <BreakdownChart
      title="By category"
      caption="Click a group to see its subcategories"
      data={data}
      isStale={isStale}
      emptyMessage="Nothing was reported in this period"
      onDrillDown={(datum) => {
        if (datum.key !== 'uncategorised') {
          onDrill(datum.key);
        }
      }}
    />
  );
}

/** "over 89 tickets that were assigned", or a note that nothing qualified. */
function overCount(count: number | undefined, milestone: string): string {
  if (!count) {
    return `Nothing in this period was ${milestone}`;
  }
  return `Over ${count} ticket${count === 1 ? '' : 's'} ${milestone} in this period`;
}

/** How many of these open, unowned tickets have been waiting over a day. */
function countStaleUnassigned(
  incidents: { created_at: string }[],
  asOf: string | undefined,
): number {
  const now = asOf ? new Date(asOf) : new Date();
  return incidents.filter(
    (incident) =>
      (now.getTime() - new Date(incident.created_at).getTime()) / 3_600_000 >= UNASSIGNED_HOURS,
  ).length;
}
