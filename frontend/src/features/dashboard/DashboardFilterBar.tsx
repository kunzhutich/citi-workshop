import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { useFacilityTree } from '../facilities/hooks';
import {
  CUSTOM_RANGE_ID,
  RANGE_PRESETS,
  type DashboardFilterControls,
} from './useDashboardFilters';

export interface DashboardFilterBarProps {
  controls: DashboardFilterControls;
}

/**
 * The dashboard's one filter row.
 *
 * **One row, above everything it scopes, never inside a card.** A filter that
 * lives beside one chart invites the reader to believe the other charts are
 * showing something else; a filter at the top of the page is a statement that
 * all the numbers below agree.
 *
 * The caveat on this particular dashboard is that the date range genuinely
 * *cannot* reach two of the widgets, because the API refuses to window a
 * present-tense question (decision D9). Hiding that would be the worse of the
 * two options, so the bar says it in a line underneath and the sections below
 * repeat it where it matters. The building filter carries no such caveat: both
 * kinds of report honour it, because it narrows which tickets are in view
 * rather than when they happened.
 *
 * The range is a list of named periods rather than a calendar. Nobody wants to
 * fight a date grid to say "last 30 days", and a preset link still means the
 * last thirty days when it is opened next week.
 */
export function DashboardFilterBar({ controls }: DashboardFilterBarProps) {
  const { filters, setFilters } = controls;
  const facilities = useFacilityTree();
  const isCustom = filters.rangeId === CUSTOM_RANGE_ID;

  return (
    <Box sx={{ mb: 1 }}>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 2,
          alignItems: 'flex-start',
        }}
      >
        <TextField
          select
          label="Date range"
          size="small"
          value={filters.rangeId}
          onChange={(event) => setFilters({ rangeId: event.target.value })}
          sx={{ minWidth: 180, flex: '0 1 200px' }}
        >
          {RANGE_PRESETS.map((preset) => (
            <MenuItem key={preset.id} value={preset.id}>
              {preset.label}
            </MenuItem>
          ))}
          <MenuItem value={CUSTOM_RANGE_ID}>Custom range…</MenuItem>
        </TextField>

        {isCustom ? (
          <>
            <TextField
              type="date"
              label="From"
              size="small"
              value={filters.from}
              onChange={(event) => setFilters({ from: event.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 160, flex: '0 1 170px' }}
            />
            <TextField
              type="date"
              label="To"
              size="small"
              value={filters.to}
              onChange={(event) => setFilters({ to: event.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 160, flex: '0 1 170px' }}
            />
          </>
        ) : null}

        <TextField
          select
          label="Building"
          size="small"
          value={filters.buildingId}
          onChange={(event) => setFilters({ buildingId: event.target.value })}
          sx={{ minWidth: 180, flex: '0 1 200px' }}
        >
          <MenuItem value="">Every building</MenuItem>
          {(facilities.data?.buildings ?? []).map((building) => (
            <MenuItem key={building.id} value={building.id}>
              {building.code} — {building.name}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        The building applies to everything below. The date range applies to the period
        section only — what is blocked or escalated <strong>right now</strong> is counted
        however old it is.
      </Typography>
    </Box>
  );
}
