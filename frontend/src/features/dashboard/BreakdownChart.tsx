import BarChartIcon from '@mui/icons-material/BarChart';
import TableRowsIcon from '@mui/icons-material/TableRows';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { BarChart } from '@mui/x-charts/BarChart';
import { PieChart } from '@mui/x-charts/PieChart';
import { useState, type ReactNode } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';

import { EmptyState } from '../../components/QueryState';
import {
  BAR_RADIUS,
  CATEGORY_GAP_RATIO,
  foldToCategoricalSlices,
  SERIES_PRIMARY,
} from './chartPalette';

/**
 * One row of a breakdown: a name, a count, and the list it stands for.
 *
 * `href` is what makes a chart segment a link rather than a picture, which
 * BUILD-PLAN section 10 asks for — every bar leads to the pre-filtered list of
 * exactly the tickets it counted, with the filters in the URL so the view is
 * bookmarkable.
 */
export interface BreakdownDatum {
  /** Stable identity for the row. Colour never depends on position. */
  key: string;
  label: string;
  value: number;
  /**
   * The pre-filtered incident list this row counted, when one exists.
   *
   * Optional for one case and it is worth stating: a pie slice that several
   * categories were folded into (see `foldToCategoricalSlices`) stands for no
   * single list, because `GET /incidents` filters on one category group at a
   * time. D14 §3 settled what to do about that — a wrong link is worse than
   * none, because it teaches a reader that the numbers cannot be checked — so
   * the slice simply does not navigate, and every folded category keeps its
   * own row and its own link in the table view.
   */
  href?: string;
  /** Overrides the single-series colour, for a genuinely ordered scale. */
  color?: string;
}

export interface BreakdownChartProps {
  title: string;
  /** What the numbers are scoped to. Shown under the title, always. */
  caption: string;
  data: BreakdownDatum[];
  /** Shown when there is nothing in the period. */
  emptyMessage: string;
  /** Extra controls in the card header — the category chart's drill-up link. */
  headerAction?: ReactNode;
  /** Dim the card while a refetch is in flight. */
  isStale?: boolean;
  /** Clicking a bar drills down instead of navigating. */
  onDrillDown?: (datum: BreakdownDatum) => void;
  /**
   * Bars, or a pie.
   *
   * **Not a free choice per card.** A pie answers "what is this made of" and
   * nothing else: it is legible for a handful of slices that are parts of one
   * whole, and it is worse than a bar at every comparison. Status and category
   * stay bars because a reader looks at those to compare one count with
   * another and, for categories, because there are five of them and a pie of
   * five slices where two are small is a puzzle. Priority and building are
   * pies because each really is a composition — of all the tickets, this
   * share was urgent; of all the tickets, this share came from that building
   * — and both have few enough slices to read at a glance.
   */
  shape?: 'bars' | 'pie';
}

/** Height of one bar's band, including its gap. Drives the chart's height. */
const BAND_HEIGHT = 34;

/** How tall a pie card's plot is. Matches a four-bar chart, so a row of cards lines up. */
const PIE_HEIGHT = 220;

/** The hole in the middle. A ring reads as a composition; a full circle reads as a clock. */
const PIE_INNER_RADIUS = 46;

/** Room under the plot for the value axis and its labels. */
const AXIS_BAND = 34;

/**
 * Room at the bar end for its value label.
 *
 * The labels sit *outside* the bars, so the longest bar needs somewhere to put
 * its number. Without this the chart drew it over the card's edge.
 */
const LABEL_GUTTER = 44;

/**
 * A horizontal bar chart of one measure across some categories, with a table.
 *
 * **Horizontal, not vertical.** Every breakdown on this dashboard has long
 * category names — "Building & Facilities", "Waiting on the employee" — and a
 * vertical bar chart either rotates them to 45° or truncates them. Sideways
 * bars give a name as much width as it needs and cost nothing else.
 *
 * **One colour for every bar.** These are nominal categories, so the bar's
 * length already carries the magnitude; shading each bar by its own value
 * would encode the same thing twice and spend the only free channel saying
 * nothing new. A caller with a genuinely ordered scale — priority — passes a
 * `color` per datum instead, which is what the ramp in `chartPalette.ts` is
 * for.
 *
 * **The table is not a fallback, it is a twin.** A bar chart puts a value
 * behind a hover, and a hover is not available to a keyboard, a screen reader
 * or a printout. The toggle gives the same numbers as text and the same links
 * as anchors, so no value on this dashboard is reachable only by pointing at
 * it.
 *
 * The chart's height is computed from the number of bars rather than fixed, so
 * a four-row breakdown is not stretched across the height of a nine-row one
 * and a nine-row one does not squeeze its labels into an unreadable band.
 */
export function BreakdownChart({
  title,
  caption,
  data,
  emptyMessage,
  headerAction,
  isStale = false,
  onDrillDown,
  shape = 'bars',
}: BreakdownChartProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const navigate = useNavigate();

  // The value axis is stretched past the largest bar so that bar ends short of
  // the plot's right edge. Without the headroom the longest bar runs flush to
  // the edge and its outside label has nowhere to render — Material UI drops
  // it, so the single most important number on the chart was the one missing.
  const largest = Math.max(...data.map((datum) => datum.value), 0);
  const axisMax = largest + Math.max(1, Math.ceil(largest * 0.15));

  /*
   * What the *pie* draws, which is not always what the table lists.
   *
   * A caller that brings its own colours has slices whose identity is already
   * decided — the priority ramp is the case, and its four steps are an ordered
   * scale that must never be folded or reordered. A caller that brings none is
   * saying "these categories have no inherent colour", and then the palette's
   * cap applies: three validated hues, with everything past them folded into
   * one neutral. Left alone that caller used to get every slice painted
   * `SERIES_PRIMARY`, which is correct for bars — the length carries the
   * magnitude — and useless for a pie, where it produces a ring of one hue
   * beside a legend of one hue.
   *
   * **The fold reaches the chart and stops there.** The table twin below still
   * lists every category with its own link, which is where a reader goes for
   * the values anyway, and is the relief case D57 leans on for the neutral's
   * contrast. Folding both would lose five links to save three colours.
   */
  const slices = shape === 'pie' && !data.every((datum) => datum.color)
    ? foldToCategoricalSlices(data)
    : data;

  const activate = (datum: BreakdownDatum | undefined) => {
    if (!datum) {
      return;
    }
    if (onDrillDown) {
      onDrillDown(datum);
      return;
    }
    if (!datum.href) {
      return;
    }
    void navigate(datum.href);
  };

  return (
    <Card sx={{ height: '100%', opacity: isStale ? 0.55 : 1, transition: 'opacity 150ms' }}>
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
              {title}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {caption}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
            {headerAction}
            <ToggleButtonGroup
              size="small"
              exclusive
              value={view}
              onChange={(_event, next: 'chart' | 'table' | null) => next && setView(next)}
              aria-label={`How to show ${title}`}
            >
              <ToggleButton value="chart" aria-label="Show as a chart">
                <BarChartIcon fontSize="small" />
              </ToggleButton>
              <ToggleButton value="table" aria-label="Show as a table">
                <TableRowsIcon fontSize="small" />
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </Box>

        {data.length === 0 ? (
          <EmptyState title={emptyMessage} />
        ) : view === 'table' ? (
          <BreakdownTable title={title} data={data} onDrillDown={onDrillDown} />
        ) : (
          /*
           * `role="img"` with a written summary. An SVG chart is a tree of a
           * few hundred `path`, `rect` and `text` nodes; left as-is a screen
           * reader walks all of them and reads the axis ticks in whatever
           * order the library emitted them. `role="img"` makes the subtree
           * presentational and replaces the lot with one sentence.
           *
           * The sentence is a summary, not the data. The data is the table
           * twin one button away, which the summary points at — a chart with
           * twelve categories read aloud as a `aria-label` is worse than
           * silence, and the table has the links as well as the numbers.
           */
          <Box role="img" aria-label={summarise(title, slices, shape)}>
            {shape === 'pie' ? (
              <PieChart
                height={PIE_HEIGHT}
                series={[
                  {
                    data: slices.map((datum) => ({
                      id: datum.key,
                      // The count rides in the legend rather than on the arc.
                      // Painted on the slice it has to contrast with whatever
                      // colour that slice is, and two of the priority steps are
                      // light enough that white sat at 2.2:1 on them — a number
                      // nobody could read, on exactly the slices a reader most
                      // wants a number for. In the legend it is text on the
                      // card, at the card's own contrast, whatever the slice
                      // behind it is doing. It also means the small slices get
                      // their value too, which an arc label cannot fit.
                      label: `${datum.label} · ${datum.value}`,
                      value: datum.value,
                      // Colour follows the row's own identity, never its
                      // position, so filtering one out cannot repaint the rest.
                      color: datum.color ?? SERIES_PRIMARY,
                    })),
                    innerRadius: PIE_INNER_RADIUS,
                    highlightScope: { highlight: 'item', fade: 'global' },
                  },
                ]}
                onItemClick={(_event, item) => activate(slices[item.dataIndex])}
                sx={(theme) => ({
                  '& .MuiPieArc-root': {
                    cursor: 'pointer',
                    // A surface-coloured edge between fills, so adjacent
                    // slices read as two marks rather than one shape with a
                    // seam in it.
                    stroke: theme.palette.background.paper,
                    strokeWidth: 2,
                  },
                  // Legend text wears a text token, never a series colour. The
                  // coloured dot beside it is what carries identity.
                  '& .MuiChartsLegend-series text': {
                    fill: `${theme.palette.text.secondary} !important`,
                    fontSize: 13,
                  },
                })}
              />
            ) : (
            <BarChart
              layout="horizontal"
              height={data.length * BAND_HEIGHT + AXIS_BAND}
              // Room for the category names; the value axis needs almost none.
              margin={{ left: 4, right: LABEL_GUTTER, top: 4, bottom: 4 }}
              yAxis={[
                {
                  scaleType: 'band',
                  data: data.map((datum) => datum.label),
                  categoryGapRatio: CATEGORY_GAP_RATIO,
                  width: 132,
                  // Colour follows the row's own entity, by value, so filtering
                  // a category out never repaints the ones that remain.
                  colorMap: {
                    type: 'ordinal',
                    values: data.map((datum) => datum.label),
                    colors: data.map((datum) => datum.color ?? SERIES_PRIMARY),
                  },
                },
              ]}
              xAxis={[{ min: 0, max: axisMax, tickMinStep: 1 }]}
              series={[
                {
                  data: data.map((datum) => datum.value),
                  label: title,
                  // The count beside each bar, so the value is readable without
                  // hovering. Zeroes are left unlabelled: a "0" floating at the
                  // axis reads as a mark rather than as an absence.
                  barLabel: (item) => (item.value ? String(item.value) : null),
                  // **Outside the bar, not centred in it.** Centred was the
                  // library's default and it put dark ink on a saturated fill:
                  // on the Critical bar — the darkest step of the priority ramp
                  // — the number was all but unreadable, and on a short bar it
                  // spilled past the end. Outside, every label sits on the card
                  // in the ordinary secondary ink, at the same contrast whatever
                  // colour the bar is and whatever its length.
                  barLabelPlacement: 'outside',
                },
              ]}
              borderRadius={BAR_RADIUS}
              // One series, named by the card's own title: a legend box would
              // repeat the heading and steal a line of the plot.
              hideLegend
              grid={{ vertical: true }}
              onItemClick={(_event, item) => activate(data[item.dataIndex])}
              // The class names are the library's own — `MuiBarChart-element`
              // for a bar and `MuiBarChart-label` for its number. The first
              // version of this guessed `MuiBarElement-root` and
              // `MuiBarLabel-root`, which match nothing: the bars never showed a
              // pointer cursor and the labels never took the ink set here. A
              // Playwright assertion on a bar being present is what found it.
              sx={(theme) => ({
                '& .MuiBarChart-element': { cursor: 'pointer' },
                // A hairline grid, one shade off the surface, so it never
                // competes with the bars.
                '& .MuiChartsGrid-line': { stroke: theme.palette.divider },
                // Axis text wears a text token, never a series colour.
                '& .MuiChartsAxis-tickLabel': { fill: theme.palette.text.secondary },
                '& .MuiBarChart-label': { fill: theme.palette.text.secondary, fontSize: 12 },
              })}
            />
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * One sentence describing a bar chart, for a screen reader.
 *
 * Deliberately short. It says what the chart is, how big it is, and where the
 * extremes are, then names the control that gives every value — which is the
 * shape of a good `alt` text for a chart: enough to decide whether to go and
 * read the numbers, not the numbers themselves.
 */
function summarise(title: string, data: BreakdownDatum[], shape: 'bars' | 'pie'): string {
  const total = data.reduce((sum, datum) => sum + datum.value, 0);
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const largest = sorted[0];
  const smallest = sorted[sorted.length - 1];

  const extremes =
    data.length > 1
      ? ` Largest: ${largest.label}, ${largest.value}. Smallest: ${smallest.label}, ${smallest.value}.`
      : ` ${largest.label}: ${largest.value}.`;

  return (
    `${shape === 'pie' ? 'Pie chart' : 'Bar chart'}: ${title}. ${data.length} ` +
    `${data.length === 1 ? 'row' : 'rows'}, ` +
    `${total} in total.${extremes} Use "Show as a table" for every value.`
  );
}

/**
 * The same numbers as text.
 *
 * `tabular-nums` here and nowhere else on the dashboard: these are a column of
 * figures that should line up, which is exactly the case the feature is for.
 */
function BreakdownTable({
  title,
  data,
  onDrillDown,
}: {
  title: string;
  data: BreakdownDatum[];
  onDrillDown?: (datum: BreakdownDatum) => void;
}) {
  return (
    <Table size="small" aria-label={`${title}, as a table`}>
      <TableHead>
        <TableRow>
          <TableCell>Category</TableCell>
          <TableCell align="right">Tickets</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {data.map((datum) => (
          <TableRow key={datum.key} hover>
            <TableCell>
              {onDrillDown ? (
                <Link component="button" type="button" onClick={() => onDrillDown(datum)}>
                  {datum.label}
                </Link>
              ) : datum.href ? (
                <Link component={RouterLink} to={datum.href}>
                  {datum.label}
                </Link>
              ) : (
                // No list is exactly this row, so it is text. Only a folded
                // remainder reaches here, and only in a chart whose table is
                // unfolded — so in practice, never.
                datum.label
              )}
            </TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {datum.value}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
