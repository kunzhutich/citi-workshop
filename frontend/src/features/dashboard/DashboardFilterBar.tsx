import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

import { DateRangeFields } from '../../components/DateRangeFields';
import { useFacilityTree } from '../facilities/hooks';
import {
  CUSTOM_RANGE_ID,
  RANGE_PRESETS,
  type DashboardFilterControls,
} from './useDashboardFilters';

/**
 * Narrowest a select may be before a bar in a slot gives up on two columns.
 *
 * Small on purpose. It is not the width a select wants — that is nearer 200 —
 * it is the width below which two of them side by side stop being readable,
 * and the only thing it decides is where one line becomes two. A slot of 316px
 * or more (two of these and the gap) holds both; anything narrower holds one.
 * A 375px phone leaves about 327px here, so the pair survives it.
 */
const SLOT_COLUMN = 150;

export interface DashboardFilterBarProps {
  controls: DashboardFilterControls;
  /**
   * What the dates and the building apply to on *this* screen.
   *
   * The default names the admin dashboard's two halves, which is wrong
   * anywhere else — the engineer profile page reuses these controls and has no
   * blocked-or-escalated section for the sentence to be about. A caption that
   * describes a screen the reader is not looking at is worse than none.
   *
   * **`false` means no caption at all**, which `null` and `undefined` cannot:
   * both fall through to the default, and that is the right behaviour for a
   * caller that simply did not pass one. The engineer page says the same thing
   * structurally — a scope label over each half, sitting on the thing it is
   * about — so a third statement of it would be the line nobody reads. It has
   * to render *nothing* rather than an empty `Typography`, or the block's own
   * margin leaves eight pixels of unexplained gap under the controls.
   */
  note?: ReactNode;
  /**
   * The bar is in a slot beside a heading rather than across a whole page.
   *
   * Two things change, and both follow from having a few hundred pixels
   * instead of a page's width.
   *
   * **The selects divide the slot instead of asking it for 200px each.** As
   * two fixed boxes they share a line only while 416px of room exists, and
   * they were asking a box that had been sized to *exactly* their own content
   * for it — a coin flip, which on the engineer page came down stacked. Two
   * `auto-fit` columns with a 150px floor is the same answer `FilterRow` gives
   * to the same question (D44): the box decides how many columns there are,
   * and with two items there is never a third line to fall onto. `ScopeHeading`
   * is the other half of this — a slot sized to its content is not a slot, so
   * it now asks for a width of its own.
   *
   * **A custom range opens underneath rather than between them.** Four
   * controls in a slot is four rows; two and then two is two.
   *
   * **False is the admin dashboard, and false is the default.** Its bar is the
   * page's own, full width above everything it scopes, where all four controls
   * fit on one line — and the pair opening *in place* is what the `Collapse`
   * is for there, the bar changing rather than two fields appearing below it.
   */
  narrow?: boolean;
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
 * last thirty days when it is opened next week. The calendar is what the last
 * entry in that list reveals, for the period no preset covers.
 *
 * **The two ends open rather than appear.** They used to be a bare conditional,
 * so picking "Custom range…" made two controls exist between one frame and the
 * next and shoved the building filter along the row with them. `Collapse` gives
 * that a direction, which is the difference between "two more fields are here"
 * and "the bar changed" — the same reasoning as `ReportSection`. Where they
 * open is the one thing `narrow` moves, and the direction survives the move.
 *
 * `unmountOnExit` with it, and not for the reason it usually earns: `Collapse`
 * hides a closed child with `visibility: hidden`, so a screen reader and the
 * tab order lose the fields either way. What unmounting adds is that a closed
 * range keeps no half-typed date of its own — `DateRangeFields` holds one while
 * a reader is mid-edit, and a pair that merely went invisible would still be
 * holding it the next time the range is opened.
 */
export function DashboardFilterBar({ controls, note, narrow = false }: DashboardFilterBarProps) {
  const { filters, setFilters } = controls;
  const facilities = useFacilityTree();
  const isCustom = filters.rangeId === CUSTOM_RANGE_ID;

  /*
   * The two ends of the range, written once and hung in one of two places.
   *
   * The pair reflows as a unit. `DateRangeFields` renders a fragment so that a
   * grid caller gets two columns, which means the flex row the two fields need
   * is this caller's to supply — and it has to be inside the collapse, whose
   * own box is the one being grown. The padding goes on that same inner box
   * rather than on the collapse: it is the thing that grows, so the space
   * above the pair grows with it instead of appearing the instant it opens.
   */
  const customRange = (
    <Collapse in={isCustom} unmountOnExit>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, pt: narrow ? 2 : 0 }}>
        <DateRangeFields
          from={filters.from}
          to={filters.to}
          onChange={setFilters}
          fieldSx={{ minWidth: 160, flex: '0 1 170px' }}
        />
      </Box>
    </Collapse>
  );

  // In a slot the column is the width; a select that also demanded 180 of its
  // own would overflow the track it was given. `minWidth: 0` is what lets the
  // grid's floor be the only floor there is.
  const selectSx = narrow ? { minWidth: 0 } : { minWidth: 180, flex: '0 1 200px' };

  return (
    <Box sx={{ mb: 1 }}>
      <Box
        sx={
          narrow
            ? {
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${SLOT_COLUMN}px), 1fr))`,
                gap: 2,
                alignItems: 'start',
              }
            : { display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-start' }
        }
      >
        <TextField
          select
          label="Date range"
          size="small"
          value={filters.rangeId}
          onChange={(event) => setFilters({ rangeId: event.target.value })}
          sx={selectSx}
        >
          {RANGE_PRESETS.map((preset) => (
            <MenuItem key={preset.id} value={preset.id}>
              {preset.label}
            </MenuItem>
          ))}
          <MenuItem value={CUSTOM_RANGE_ID}>Custom range…</MenuItem>
        </TextField>

        {narrow ? null : customRange}

        <TextField
          select
          label="Building"
          size="small"
          value={filters.buildingId}
          onChange={(event) => setFilters({ buildingId: event.target.value })}
          sx={selectSx}
          // Without `displayEmpty` the "Every building" option is selected but
          // draws nothing, so the control reads as an unfilled field rather
          // than as the state it is actually in. Pinning the label up keeps it
          // from overlapping the text that now appears there.
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        >
          <MenuItem value="">Every building</MenuItem>
          {(facilities.data?.buildings ?? []).map((building) => (
            <MenuItem key={building.id} value={building.id}>
              {building.code} — {building.name}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      {narrow ? customRange : null}

      {note === false ? null : (
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        {note ?? (
          <>
            The building applies to everything below. The date range applies to the period
            section only — what is blocked or escalated <strong>right now</strong> is counted
            however old it is.
          </>
        )}
      </Typography>
      )}
    </Box>
  );
}
