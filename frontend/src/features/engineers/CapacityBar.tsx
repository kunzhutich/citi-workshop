import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';

export interface CapacityBarProps {
  active: number;
  max: number;
}

/**
 * How much of an engineer's capacity is spoken for.
 *
 * `max_active_tickets` is a **soft** limit: assigning past it succeeds and
 * returns a warning, because an admin who has decided to overload a lead is
 * making a judgement the system records rather than overrules. The bar is
 * drawn to match — it turns red at the limit instead of refusing to grow, and
 * the number beside it keeps counting past the maximum.
 */
export function CapacityBar({ active, max }: CapacityBarProps) {
  const ratio = max > 0 ? active / max : 0;
  const colour = ratio >= 1 ? 'error' : ratio >= 0.8 ? 'warning' : 'primary';

  return (
    <Box sx={{ minWidth: 120 }}>
      <LinearProgress
        variant="determinate"
        value={Math.min(ratio, 1) * 100}
        color={colour}
        aria-label={`${active} of ${max} tickets`}
        sx={(theme) => ({
          height: 8,
          borderRadius: 1,
          // A neutral track. Material UI tints it with the bar's own colour,
          // so an engineer with nothing assigned drew a full-width pale blue
          // bar — which reads as "full" at exactly the moment it means
          // "empty", and this bar exists to answer "who has room?".
          backgroundColor: theme.palette.action.hover,
        })}
      />
      <Typography variant="caption" color="text.secondary">
        {active} / {max} active
      </Typography>
    </Box>
  );
}
