import ShowChartIcon from '@mui/icons-material/ShowChart';
import TableRowsIcon from '@mui/icons-material/TableRows';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { LineChart } from '@mui/x-charts/LineChart';
import { useState } from 'react';

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
 *
 * **It has a table twin, as of S6.** Every other chart on this dashboard had
 * one and this one did not, which made the guide's claim that "no value on
 * this dashboard is reachable only by pointing at it" false for precisely the
 * chart with the most values in it: every point here was behind a hover, and a
 * hover is available to neither a keyboard nor a screen reader nor a printout.
 * The toggle is the same control `BreakdownChart` uses, in the same corner.
 */
export function FlowChart({ perDay, isStale = false }: FlowChartProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const hasAnything = perDay.some((day) => day.created > 0 || day.closed > 0);

  // Label every Nth day rather than letting the axis drop whichever labels
  // happen to collide. Left to itself it thinned August to every second day
  // and kept every day in September, because the shorter labels fitted — an
  // axis whose spacing changes halfway across reads as a rendering fault.
  const tickEvery = Math.max(1, Math.ceil(perDay.length / 10));

  return (
    <Card sx={{ opacity: isStale ? 0.55 : 1, transition: 'opacity 150ms' }}>
      <CardContent>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 1,
            mb: 1,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h3" component="h3">
              Reported and closed, by day
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Reported counts the day a ticket was raised; closed counts the day it was closed,
              whenever it was raised.
            </Typography>
          </Box>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={view}
            onChange={(_event, next: 'chart' | 'table' | null) => next && setView(next)}
            aria-label="How to show reported and closed by day"
            sx={{ flexShrink: 0 }}
          >
            <ToggleButton value="chart" aria-label="Show as a chart">
              <ShowChartIcon fontSize="small" />
            </ToggleButton>
            <ToggleButton value="table" aria-label="Show as a table">
              <TableRowsIcon fontSize="small" />
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {perDay.length === 0 || !hasAnything ? (
          <EmptyState title="Nothing was reported or closed in this period" />
        ) : view === 'table' ? (
          <FlowTable perDay={perDay} />
        ) : (
          // Same reasoning as `BreakdownChart`: one sentence in place of a few
          // hundred SVG nodes, pointing at the table that holds every value.
          <Box role="img" aria-label={summarise(perDay)}>
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
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * One sentence describing the flow chart, for a screen reader.
 *
 * Totals and the busiest day, then a pointer at the table. Reading 90 daily
 * pairs aloud would be worse than saying nothing.
 */
function summarise(perDay: DayCount[]): string {
  const reported = perDay.reduce((sum, day) => sum + day.created, 0);
  const closed = perDay.reduce((sum, day) => sum + day.closed, 0);
  const busiest = perDay.reduce(
    (best, day) => (day.created > best.created ? day : best),
    perDay[0],
  );

  return (
    `Line chart: tickets reported and closed per day over ${perDay.length} days. ` +
    `${reported} reported, ${closed} closed in total. ` +
    `Busiest day for reports: ${formatDayLong(busiest.day)}, ${busiest.created}. ` +
    'Use "Show as a table" for every day.'
  );
}

/**
 * The same numbers as text.
 *
 * Days with nothing on them are included rather than filtered out: the series
 * comes from `generate_series` in `repositories/reports.py` precisely so that a
 * quiet day is a zero rather than a gap, and a table that dropped them would
 * undo that.
 */
function FlowTable({ perDay }: { perDay: DayCount[] }) {
  return (
    <Box sx={{ maxHeight: CHART_HEIGHT, overflowY: 'auto' }}>
      <Table size="small" stickyHeader aria-label="Reported and closed by day, as a table">
        <TableHead>
          <TableRow>
            <TableCell>Day</TableCell>
            <TableCell align="right">Reported</TableCell>
            <TableCell align="right">Closed</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {perDay.map((day) => (
            <TableRow key={day.day} hover>
              <TableCell>{formatDayLong(day.day)}</TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {day.created}
              </TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {day.closed}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
