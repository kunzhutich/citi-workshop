import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import { LineChart } from '@mui/x-charts/LineChart';

import type { DayCount } from '../../api/reports';
import { EmptyState } from '../../components/QueryState';
import { formatDayLong, formatDayShort } from '../../display/time';

import { SERIES_PRIMARY, SERIES_SECONDARY } from './chartPalette';

export interface FlowChartProps {
  /** `summary.per_day` — every day in the window, zeroes included. */
  perDay: DayCount[];
  isStale?: boolean;
}

/** How tall the plot is, including the day axis beneath it. */
const CHART_HEIGHT = 260;

/**
 * Tickets reported against tickets closed, day by day.
 *
 * The one chart on this dashboard where the date range is the subject rather
 * than a filter: it is a picture of whether the team is keeping up, and it can
 * only be read over a period. It is also the clearest possible statement that
 * the range control does something, which is worth having beside the
 * current-state panels that it deliberately does not reach.
 *
 * **Two series, so two categorical hues and a legend** — blue for reported,
 * orange for closed. Both clear the colour-blindness separation floor against
 * each other on this surface by a wide margin, and the legend means colour is
 * never the only thing distinguishing them.
 *
 * **The two counts measure different timestamps and the caption says so.**
 * "Reported" counts by `created_at` and "closed" by `closed_at`, so a ticket
 * raised in July and closed today appears only in today's orange point. That
 * is the honest way to draw the flow — a closed series restricted to tickets
 * raised inside the window would make a backlog being worked through look like
 * no work at all.
 */
export function FlowChart({ perDay, isStale = false }: FlowChartProps) {
  const hasAnything = perDay.some((day) => day.created > 0 || day.closed > 0);

  // Label every Nth day rather than letting the axis drop whichever labels
  // happen to collide. Left to itself it thinned August to every second day
  // and kept every day in September, because the shorter labels fitted — an
  // axis whose spacing changes halfway across reads as a rendering fault.
  const tickEvery = Math.max(1, Math.ceil(perDay.length / 10));

  return (
    <Card sx={{ opacity: isStale ? 0.55 : 1, transition: 'opacity 150ms' }}>
      <CardContent>
        <Box sx={{ mb: 1 }}>
          <Typography variant="h3" component="h3">
            Reported and closed, by day
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Reported counts the day a ticket was raised; closed counts the day it was closed,
            whenever it was raised.
          </Typography>
        </Box>

        {perDay.length === 0 || !hasAnything ? (
          <EmptyState title="Nothing was reported or closed in this period" />
        ) : (
          <LineChart
            height={CHART_HEIGHT}
            // Room on the right for the last tick label, which was clipped to
            // "Se…" before this.
            margin={{ left: 4, right: 28, top: 4, bottom: 4 }}
            xAxis={[
              {
                scaleType: 'point',
                data: perDay.map((day) => day.day),
                // Day and month only. The full date carries a year that is the
                // same on every tick, and the extra six characters were enough
                // to push the last label off the right edge of the card.
                valueFormatter: (value: string, context) =>
                  context.location === 'tick' ? formatDayShort(value) : formatDayLong(value),
                // Every day is a point; labelling every one would collide, so
                // the axis thins them and the tooltip carries the rest.
                tickLabelStyle: { fontSize: 11 },
                tickInterval: (_value, index) => index % tickEvery === 0,
              },
            ]}
            yAxis={[{ min: 0, tickMinStep: 1, width: 36 }]}
            series={[
              {
                id: 'created',
                data: perDay.map((day) => day.created),
                label: 'Reported',
                color: SERIES_PRIMARY,
                showMark: false,
                curve: 'linear',
              },
              {
                id: 'closed',
                data: perDay.map((day) => day.closed),
                label: 'Closed',
                color: SERIES_SECONDARY,
                showMark: false,
                curve: 'linear',
              },
            ]}
            grid={{ horizontal: true }}
            sx={(theme) => ({
              // `MuiLineChart-line`, the library's own class. See the note in
              // BreakdownChart.tsx: the guessed name matched nothing.
              '& .MuiLineChart-line': { strokeWidth: 2 },
              '& .MuiChartsGrid-line': { stroke: theme.palette.divider },
              '& .MuiChartsAxis-tickLabel': { fill: theme.palette.text.secondary },
            })}
          />
        )}
      </CardContent>
    </Card>
  );
}


