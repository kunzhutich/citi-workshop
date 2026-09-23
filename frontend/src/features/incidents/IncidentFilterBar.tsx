import FilterListIcon from '@mui/icons-material/FilterList';
import SearchIcon from '@mui/icons-material/Search';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Drawer from '@mui/material/Drawer';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputAdornment from '@mui/material/InputAdornment';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';

import type { IncidentPriority, IncidentStatus } from '../../api/types';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import {
  INCIDENT_PRIORITIES,
  INCIDENT_STATUSES,
  priorityLabel,
  statusLabel,
} from '../../display/labels';
import { useCategoryTree } from '../categories/hooks';
import { useFacilityTree } from '../facilities/hooks';
import { AppliedFilterChips } from './AppliedFilterChips';
import type { IncidentFilterControls } from './useIncidentFilters';

/** How long to wait after the last keystroke before searching, in milliseconds. */
const SEARCH_DEBOUNCE_MS = 350;

export interface IncidentFilterBarProps {
  controls: IncidentFilterControls;
}

/**
 * Narrowing a list of tickets.
 *
 * On desktop the controls sit inline above the table. On a phone they move
 * into a bottom drawer behind one button, because six controls across a 375px
 * viewport would push the list itself below the fold — the filters would take
 * up more room than the thing being filtered.
 *
 * The search box is the one control with local state. Everything else writes
 * straight to the URL on change; typing cannot, because a request per
 * keystroke would put a full-text search on the database for every letter.
 */
export function IncidentFilterBar({ controls }: IncidentFilterBarProps) {
  const { isMobile } = useBreakpoint();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const controlsMarkup = <FilterControls controls={controls} />;

  if (!isMobile) {
    return (
      <Box sx={{ mb: 3 }}>
        {controlsMarkup}
        {/* Outside the controls grid and outside the phone's drawer: a filter
            that arrived by link has to be visible without opening anything. */}
        <Box sx={{ mt: 2 }}>
          <AppliedFilterChips controls={controls} />
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ mb: 2 }}>
      <AppliedFilterChips controls={controls} />
      <Badge badgeContent={controls.activeCount} color="primary">
        <Button variant="outlined" startIcon={<FilterListIcon />} onClick={() => setDrawerOpen(true)}>
          Search and filter
        </Button>
      </Badge>

      <Drawer
        anchor="bottom"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        slotProps={{ paper: { sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16 } } }}
      >
        <Box sx={{ p: 2, pb: 4 }}>
          <Typography variant="h3" gutterBottom>
            Search and filter
          </Typography>
          {controlsMarkup}
          <Button fullWidth variant="contained" sx={{ mt: 2 }} onClick={() => setDrawerOpen(false)}>
            Show results
          </Button>
        </Box>
      </Drawer>
    </Box>
  );
}

function FilterControls({ controls }: IncidentFilterBarProps) {
  const { filters, setFilters, reset, activeCount } = controls;
  const categories = useCategoryTree();
  const facilities = useFacilityTree();

  const [search, setSearch] = useState(filters.q);
  const [termFromUrl, setTermFromUrl] = useState(filters.q);

  // Keep the box in step when the URL changes from elsewhere — the top bar's
  // global search, or the back button. Adjusted during render rather than in
  // an effect: React re-runs this component before touching the DOM, so there
  // is no flash of the stale term, and no second render pass to pay for.
  if (filters.q !== termFromUrl) {
    setTermFromUrl(filters.q);
    setSearch(filters.q);
  }

  useEffect(() => {
    if (search === filters.q) {
      return;
    }
    const timer = setTimeout(() => setFilters({ q: search }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, filters.q, setFilters]);

  return (
    /*
     * The column count follows the width of *this box*, not the width of the
     * window.
     *
     * It used to be a six-column template behind Material UI's `md`
     * breakpoint, and `md` is a media query: it asks how wide the viewport is.
     * This bar does not live in the viewport. It lives inside `<main>`, which
     * on a desktop is 248px of permanent drawer and 48px of padding narrower
     * than the window — so between roughly 900px and 1300px the six columns
     * switched on while their own minimums (200 + 4x140 + the switch + five
     * gaps, about 950px) did not fit in the 620-900px actually available. Grid
     * tracks cannot shrink below a `minmax()` minimum, so the bar pushed out
     * of `<main>` and the whole document scrolled sideways. Chrome showed it
     * sooner than Firefox because its classic scrollbar takes another 15px of
     * layout width.
     *
     * `auto-fit` with a `minmax()` floor asks the question the right way
     * round: fit as many 160px columns as the available width holds, and share
     * the remainder between them. There is no breakpoint to get wrong, and
     * `min(100%, 160px)` is the part that matters on a phone — without it a
     * container narrower than 160px would still be overflowed by one column.
     */
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))',
        alignItems: 'start',
      }}
    >
      <TextField
        label="Search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="INC-000123, or words from the ticket"
        size="small"
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          },
        }}
      />

      <TextField
        select
        label="Status"
        size="small"
        value={filters.statuses}
        onChange={(event) =>
          setFilters({ statuses: toArray(event.target.value) as IncidentStatus[] })
        }
        slotProps={{
          select: {
            multiple: true,
            renderValue: (selected) =>
              (selected as IncidentStatus[]).map(statusLabel).join(', ') || 'Any',
            displayEmpty: true,
          },
          // `displayEmpty` draws "Any" inside the field while nothing is
          // selected, and an unshrunk label is drawn in the same place — the
          // two overlapped into "Ätnays". Pinning the label up fixes it.
          inputLabel: { shrink: true },
        }}
      >
        {INCIDENT_STATUSES.map((option) => (
          <MenuItem key={option} value={option}>
            <Checkbox size="small" checked={filters.statuses.includes(option)} />
            <ListItemText primary={statusLabel(option)} />
          </MenuItem>
        ))}
      </TextField>

      <TextField
        select
        label="Priority"
        size="small"
        value={filters.priorities}
        onChange={(event) =>
          setFilters({ priorities: toArray(event.target.value) as IncidentPriority[] })
        }
        slotProps={{
          select: {
            multiple: true,
            renderValue: (selected) =>
              (selected as IncidentPriority[]).map(priorityLabel).join(', ') || 'Any',
            displayEmpty: true,
          },
          inputLabel: { shrink: true },
        }}
      >
        {INCIDENT_PRIORITIES.map((option) => (
          <MenuItem key={option} value={option}>
            <Checkbox size="small" checked={filters.priorities.includes(option)} />
            <ListItemText primary={priorityLabel(option)} />
          </MenuItem>
        ))}
      </TextField>

      <TextField
        select
        label="Category"
        size="small"
        value={filters.groupId}
        onChange={(event) => setFilters({ groupId: event.target.value })}
      >
        <MenuItem value="">Any category</MenuItem>
        {(categories.data?.groups ?? []).map((group) => (
          <MenuItem key={group.id} value={group.id}>
            {group.name}
          </MenuItem>
        ))}
      </TextField>

      <TextField
        select
        label="Building"
        size="small"
        value={filters.buildingId}
        onChange={(event) => setFilters({ buildingId: event.target.value })}
      >
        <MenuItem value="">Any building</MenuItem>
        {(facilities.data?.buildings ?? []).map((building) => (
          <MenuItem key={building.id} value={building.id}>
            {building.code}
          </MenuItem>
        ))}
      </TextField>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={filters.escalatedOnly}
              onChange={(event) => setFilters({ escalatedOnly: event.target.checked })}
            />
          }
          label={<Typography variant="body2">Escalated</Typography>}
        />
        {activeCount > 0 ? (
          <Button size="small" onClick={reset}>
            Clear
          </Button>
        ) : null}
      </Box>
    </Box>
  );
}

/** MUI hands a multi-select's value back as a string when it has one entry. */
function toArray(value: string | string[]): string[] {
  return typeof value === 'string' ? value.split(',').filter(Boolean) : value;
}
