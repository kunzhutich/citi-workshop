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

import type { IncidentQuery } from '../../api/incidents';
import type { CurrentUser, Engineer, IncidentPriority, IncidentStatus } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import {
  INCIDENT_PRIORITIES,
  INCIDENT_STATUSES,
  priorityLabel,
  statusLabel,
} from '../../display/labels';
import { calendarDayOf, endOfDayInstant, startOfDayInstant } from '../../display/time';
import { useCategoryTree } from '../categories/hooks';
import { useEngineers } from '../engineers/hooks';
import { useFacilityTree } from '../facilities/hooks';
import { DateRangeFields } from '../../components/DateRangeFields';
import { FilterRow } from '../../components/FilterRow';
import { AppliedFilterChips } from './AppliedFilterChips';
import type { IncidentFilterControls, IncidentFilters } from './useIncidentFilters';

/** Which controls a screen's own preset has already decided. */
interface FixedByPreset {
  status: boolean;
  assignee: boolean;
}

/**
 * Read a screen's preset as the set of controls it makes pointless.
 *
 * Two of them today, and each is a rule that lives on the server rather than
 * here. **Status**, because `/unassigned` pins `status: ['OPEN']` and the
 * preset wins. **Assignee**, for two different reasons that land in the same
 * place: `assignee_id` in the preset is the same override, and `mine:
 * 'assigned'` is resolved in `services/incident_service.py` by *overwriting*
 * `assignee_id` with the caller's own id — so My queue's engineer control was
 * writing a filter the API then replaced.
 *
 * This is deliberately a reading of the preset rather than a list of screens.
 * A fifth list added next year gets the right bar without anybody remembering
 * this file, and the engineer page's embedded list — preset `{ assignee_id }`
 * — already got it without being thought about.
 *
 * The inert Status control predates R7 and is fixed here too: the mechanism
 * costs nothing once it exists, and leaving one lying control beside a fixed
 * one would be harder to explain than either.
 *
 * Not exported, like `mayFilterByEngineer` below it — `react-refresh` allows a
 * component file to export components and nothing else, and a second module
 * for two predicates that only this bar asks would be worse. It is tested
 * through the bar, which is the honest test anyway: the claim is that the
 * control is *not drawn*, not that a function returned true.
 */
function fixedByPreset(preset: IncidentQuery | undefined): FixedByPreset {
  return {
    status: (preset?.status?.length ?? 0) > 0,
    assignee: preset?.assignee_id !== undefined || preset?.mine === 'assigned',
  };
}

/** How long to wait after the last keystroke before searching, in milliseconds. */
const SEARCH_DEBOUNCE_MS = 350;

export interface IncidentFilterBarProps {
  controls: IncidentFilterControls;
  /**
   * What the screen itself fixes, so the bar does not offer to change it.
   *
   * `toQuery` applies the preset **after** the reader's filters precisely so
   * that a screen cannot be filtered into being a different screen — My queue
   * narrowed to somebody else's tickets is not My queue. The consequence is
   * that a control over a value the preset also sets writes the URL and
   * changes nothing: a filter that lies. Passing the preset in is what lets
   * the bar leave those controls out. See `fixedByPreset`.
   */
  preset?: IncidentQuery;
}

/**
 * Narrowing a list of tickets.
 *
 * On desktop the controls sit inline above the table. On a phone they move
 * into a bottom drawer behind one button, because eight or nine controls
 * across a 375px viewport would push the list itself far below the fold — the
 * filters would take up more room than the thing being filtered.
 *
 * The search box is the one control with local state. Everything else writes
 * straight to the URL on change; typing cannot, because a request per
 * keystroke would put a full-text search on the database for every letter.
 *
 * Two of the controls are newer than the rest and arrived from the other end:
 * the reported-between range and the engineer both existed as *filters* first,
 * carried by the dashboard's links and shown only as removable chips. A chip is
 * a way to see and undo a filter somebody else applied, and a poor way to apply
 * one — so R7 gave both a control, and `AppliedFilterChips` now draws a chip
 * only for what this reader has no control for.
 */
export function IncidentFilterBar({ controls, preset }: IncidentFilterBarProps) {
  const { isMobile } = useBreakpoint();
  const { user } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const fixed = fixedByPreset(preset);
  // Decided once and handed to both halves of the bar, because it answers two
  // questions that must not disagree: whether to draw the engineer control,
  // and therefore whether an assignee filter still needs a chip. A screen that
  // fixes the assignee itself draws neither — an inert control and a chip
  // offering to remove an inert filter are the same lie twice.
  const showEngineerFilter = mayFilterByEngineer(user) && !fixed.assignee;

  const controlsMarkup = (
    <FilterControls controls={controls} showEngineerFilter={showEngineerFilter} fixed={fixed} />
  );

  if (!isMobile) {
    return (
      <Box sx={{ mb: 3 }}>
        {controlsMarkup}
        {/* Outside the controls grid and outside the phone's drawer: a filter
            that arrived by link has to be visible without opening anything. */}
        <Box sx={{ mt: 2 }}>
          <AppliedFilterChips
            controls={controls}
            hasAssigneeControl={showEngineerFilter || fixed.assignee}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ mb: 2 }}>
      <AppliedFilterChips
        controls={controls}
        hasAssigneeControl={showEngineerFilter || fixed.assignee}
      />
      {/* Full width, per §4.4. The badge has to stretch too, or a full-width
          button inside a shrink-wrapped badge leaves the count floating in the
          middle of the row rather than on the button's corner. */}
      <Badge
        badgeContent={controls.activeCount}
        color="primary"
        sx={{ display: 'block', '& .MuiBadge-badge': { right: 8, top: 8 } }}
      >
        <Button
          fullWidth
          variant="outlined"
          startIcon={<FilterListIcon />}
          onClick={() => setDrawerOpen(true)}
        >
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

interface FilterControlsProps extends IncidentFilterBarProps {
  /** Whether to draw the engineer filter. See `mayFilterByEngineer`. */
  showEngineerFilter: boolean;
  /** Which controls this screen has already decided. See `fixedByPreset`. */
  fixed: FixedByPreset;
}

function FilterControls({ controls, showEngineerFilter, fixed }: FilterControlsProps) {
  const { filters, setFilters, reset, activeCount } = controls;
  const categories = useCategoryTree();
  const facilities = useFacilityTree();
  // `enabled`, so a reader who is not offered the control never sends the
  // request either — for an employee it would be answered with a 403 they can
  // do nothing about. The page size matches the Team page and the assign
  // dialog: three callers asking the same question with the same parameters
  // share one cache entry and therefore one request.
  const engineers = useEngineers({ page_size: 100 }, showEngineerFilter);
  const roster = engineers.data?.items ?? [];

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
    // A narrower column than `FilterRow`'s default, and 160px is now a floor
    // rather than a preference: a date field has to show `MM/DD/YYYY` and its
    // calendar button, which is what the dashboard's copy of the same two
    // fields settled on. Eight or nine controls will not fit on one line at
    // any window this application is used at, so the row wraps — which is the
    // reflow working, not failing. Everything else about it, and why it is
    // not a breakpoint, is in `FilterRow` and in D44.
    <FilterRow minColumn={160}>
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

      {fixed.status ? null : (
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
      )}

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

      {showEngineerFilter ? (
        <TextField
          select
          label="Engineer"
          size="small"
          value={filters.assigneeId}
          onChange={(event) => setFilters({ assigneeId: event.target.value })}
        >
          <MenuItem value="">Any engineer</MenuItem>
          {/* Offered beside the named engineers because the dashboard links
              here with `assignee_id=unassigned`, and a value the control
              cannot represent is a filter the reader cannot take off the one
              control that claims to own it. */}
          <MenuItem value="unassigned">Unassigned</MenuItem>
          {roster.map((engineer) => (
            <MenuItem key={engineer.user_id} value={engineer.user_id}>
              {engineer.full_name}
            </MenuItem>
          ))}
          {/* The id in the URL need not be on the roster: the roster has been
              deactivated out from under it, or has simply not arrived yet.
              Without a matching item the select draws an empty field for a
              filter that is applied — the one thing `AppliedFilterChips` was
              written to prevent — so the value keeps an entry of its own,
              named the way the chip names an assignee it cannot resolve. */}
          {isUnlistedAssignee(filters.assigneeId, roster) ? (
            <MenuItem value={filters.assigneeId}>One engineer</MenuItem>
          ) : null}
        </TextField>
      ) : null}

      {/* Ahead of the two pickers rather than after them, so that "Reported
          from" and "Reported to" are the last two items in the grid: a range
          whose two ends land on different rows reads as two unrelated fields
          rather than as one range.

          It improves the odds rather than guaranteeing anything, and the
          reason is D44. `FilterRow` is `auto-fit` on the width this bar
          actually has, so the number of columns follows the window, and the
          number of controls follows the screen's preset — My queue and the
          engineer page draw eight of these, `/unassigned` seven, an admin's
          full list nine. The pair shares a row unless the column count divides
          the position of the first of them. At 1440px, which is six columns,
          that is the eight-control screens fixed and `/unassigned` traded
          away; both are in this phase's summary.

          The Clear button stays inside this box rather than becoming a grid
          item of its own, and not for tidiness: it appears with `activeCount`,
          so a tenth item would shift every column boundary the moment a reader
          applied a filter. */}
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

      {/* Two grid items, not one: `DateRangeFields` renders a fragment so that
          each picker gets a column of its own here. `fullWidth` for the same
          reason the selects do not set a width — in this grid the column
          decides, and a control that sizes itself is what D44 is about. */}
      <DateRangeFields
        fromLabel="Reported from"
        toLabel="Reported to"
        from={calendarDayOf(filters.createdFrom)}
        to={calendarDayOf(filters.createdTo)}
        onChange={(range) => setFilters(toCreatedFilters(range))}
        fullWidth
      />
    </FilterRow>
  );
}

/** MUI hands a multi-select's value back as a string when it has one entry. */
function toArray(value: string | string[]): string[] {
  return typeof value === 'string' ? value.split(',').filter(Boolean) : value;
}

/**
 * Whether this reader is offered the engineer filter.
 *
 * Facility admins and LEAD engineers — the line `layout/navigation.ts` already
 * draws for the Team page, asked the same way, from the session's role and the
 * profile's level. "Who thinks about other people's work" should have one
 * answer in this application rather than two that drift apart.
 *
 * **The privileged thing is the roster, not the filter.** `GET /incidents`
 * answers every signed-in user, `assignee_id` and all: the brief wants an
 * employee to be able to check whether a problem is already reported, and
 * `routers/incidents.py` says so in its own first paragraph. What refuses an
 * employee is `GET /engineers` — `STAFF_ONLY`, `ROLE_NOT_PERMITTED`, measured
 * against the running API rather than assumed. So the filter behind this
 * control would work for them and the control could never be filled in.
 * Hiding it is what keeps them away from an error they can do nothing about,
 * and the chip is what still lets them take such a filter off when a link
 * brings one.
 *
 * A JUNIOR or SENIOR engineer *may* read the roster, so their exclusion is not
 * about permission at all: narrowing a list to one person's name is the
 * question somebody distributing work asks, and the navigation has already
 * decided that a LEAD is who that is. Either way this is presentation — the
 * API is what enforces anything.
 */
function mayFilterByEngineer(user: CurrentUser | null): boolean {
  return user?.role === 'FACILITY_ADMIN' || user?.engineer_profile?.level === 'LEAD';
}

/** Whether an assignee filter names somebody the loaded roster does not hold. */
function isUnlistedAssignee(assigneeId: string, roster: Engineer[]): boolean {
  if (!assigneeId || assigneeId === 'unassigned') {
    return false;
  }
  return !roster.some((engineer) => engineer.user_id === assigneeId);
}

/**
 * A picked day, as the instant this filter is actually made of.
 *
 * `createdFrom` and `createdTo` are ISO-8601 instants because the dashboard's
 * links carry the exact window a report was computed over, and rounding that
 * to a day would land the reader on a different set of tickets from the one
 * the tile counted. The pickers speak calendar days. This is the one edge
 * where the two meet, so both directions are converted here — out through
 * `startOfDayInstant`/`endOfDayInstant`, in through `calendarDayOf` above.
 *
 * `to` is widened to the end of its day, not left at its midnight, or a range
 * ending on 23 September would quietly exclude everything reported on the 23rd.
 *
 * Only the end that moved is written, which is `DateRangeFields`' contract and
 * what keeps a link honest: adjusting one end leaves the other the instant it
 * arrived as rather than rounding it to midnight on the way past.
 */
function toCreatedFilters(range: { from?: string; to?: string }): Partial<IncidentFilters> {
  const changes: Partial<IncidentFilters> = {};
  if (range.from !== undefined) {
    changes.createdFrom = range.from ? startOfDayInstant(range.from) : '';
  }
  if (range.to !== undefined) {
    changes.createdTo = range.to ? endOfDayInstant(range.to) : '';
  }
  return changes;
}
