import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';

/**
 * One number, its name, and what it is a number *about*.
 *
 * The third line is the reason this component exists rather than a `<Card>`
 * with two `<Typography>`s in it. A dashboard tile reading "Blocked · 21"
 * under a "last 30 days" filter is a lie if that 21 is every blocked ticket
 * there has ever been, and that exact confusion is what decision D9 in
 * `docs/DECISION-LOG.md` was raised to fix in the API. `caption` is where the
 * tile says which of the two it is — "right now" or "reported 25 Aug – 23 Sep"
 * — and it is a required prop for that reason: a tile cannot be added without
 * someone deciding what its number is scoped to.
 *
 * A tile with a `to` is a link into the list of exactly the tickets it counted,
 * filters and all, per BUILD-PLAN section 10. A tile without one is a number
 * that has no list behind it — a median, a percentage — and it renders as a
 * plain card so that nothing invites a click that would go nowhere.
 */
export interface StatTileProps {
  /** What the number is, in sentence case and without a trailing colon. */
  label: string;
  /** The number itself, or a dash when there is nothing to show. */
  value: ReactNode;
  /**
   * What the number is scoped to, in the reader's words.
   *
   * Required. See the note above: a tile that does not say whether it is
   * describing a period or the present is the defect this project already
   * fixed once in the API, and it must not come back through the UI.
   */
  caption: string;
  /** The pre-filtered list this number came from, if it has one. */
  to?: string;
  /** Shown before the label — an escalation flag, a warning triangle. */
  icon?: ReactNode;
  /** Dimmed while a refetch is in flight, so a stale number looks stale. */
  isStale?: boolean;
}

export function StatTile({ label, value, caption, to, icon, isStale = false }: StatTileProps) {
  const body = (
    <CardContent sx={{ py: 2 }}>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
      >
        {icon}
        {label}
      </Typography>
      <Typography
        component="p"
        sx={{
          // Proportional figures, not tabular: at this size equal-width digits
          // make a number like 121 look loose. Tabular is for columns.
          fontSize: '2rem',
          fontWeight: 600,
          lineHeight: 1.2,
          mt: 0.5,
        }}
      >
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        {caption}
      </Typography>
    </CardContent>
  );

  return (
    <Card sx={{ height: '100%', opacity: isStale ? 0.55 : 1, transition: 'opacity 150ms' }}>
      {to ? (
        <CardActionArea component={RouterLink} to={to} sx={{ height: '100%' }}>
          {body}
        </CardActionArea>
      ) : (
        body
      )}
    </Card>
  );
}

/**
 * The grid the tiles sit in.
 *
 * One column on a phone, two on a tablet, then as many as fit. CSS Grid rather
 * than MUI's `Grid`, because every tile here is the same width and the only
 * thing that changes is how many of them fit on a row.
 */
export interface StatTileGridProps {
  children: ReactNode;
  /** Smallest a tile may get before the grid drops a column. */
  minWidth?: number;
}

export function StatTileGrid({ children, minWidth = 190 }: StatTileGridProps) {
  return (
    // `auto-fit` with a floor, so five tiles become five, three and two, or a
    // single column on a 375px phone, without a breakpoint per count.
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: `repeat(auto-fit, minmax(${minWidth}px, 1fr))`,
      }}
    >
      {children}
    </Box>
  );
}
