import type { SxProps, Theme } from '@mui/material/styles';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import type { DateValidationError } from '@mui/x-date-pickers/models';
import dayjs, { type Dayjs } from 'dayjs';
import { useState } from 'react';

/**
 * The format both ends of the range are written in.
 *
 * A calendar day, not an instant: the dashboard stores these two strings in
 * the address bar and widens them to whole local days when it asks the API for
 * a window (`resolvePeriod` in `useDashboardFilters.ts`). Putting an instant in
 * the URL would make the link mean a different period in a different timezone,
 * which is not what someone who typed two dates meant.
 */
const DAY_FORMAT = 'YYYY-MM-DD';

/**
 * How a chosen day is *shown* in the field, which is not how it is stored.
 *
 * **Stated rather than left to the adapter, because the adapter's answer is
 * ambiguous.** dayjs's default locale is `en`, so a picker left alone renders
 * `09/01/2026` — which is the first of September to some readers and the ninth
 * of January to others, and nothing on screen says which. That sat directly
 * beside a heading reading "Counted over Sep 1, 2026 – Sep 20, 2026": the same
 * value, printed two ways, one of them unreadable.
 *
 * A month abbreviation cannot be misread, and it is the form the rest of the
 * application already uses — `formatDate` in `display/time.ts` asks
 * `toLocaleDateString` for a short month for exactly this reason. It is not
 * *identical* to that helper, which follows the reader's own locale and cannot
 * here: a picker's format is also its input grammar, and a field whose section
 * order changed with the browser would be a different control in different
 * hands. Unambiguous everywhere beats familiar somewhere.
 *
 * Numbers still type — Material UI's month section takes digits whatever it
 * prints, so 1-2 then 0-3 fills "12 Mar". What does change is the *order* the
 * sections are filled in, day first rather than month, because a picker's
 * format is also its input grammar. That is the cost of this line and the only
 * one; it is paid once, by everybody, in exchange for a field nobody can
 * misread.
 */
const FIELD_FORMAT = 'DD MMM YYYY';

export interface DateRangeFieldsProps {
  /** Start of the range as `YYYY-MM-DD`, or `''` when unset. */
  from: string;
  /** End of the range as `YYYY-MM-DD`, or `''` when unset. */
  to: string;
  /**
   * Called with **only the end that moved**, never with both.
   *
   * The shape is deliberately the same as the filter hooks' `setFilters`, so a
   * caller whose state is already keyed `from`/`to` can pass it straight in.
   */
  onChange: (changes: { from?: string; to?: string }) => void;
  /**
   * Defaults to "From".
   *
   * A bar with only one range in it can leave both labels alone; one that also
   * filters on, say, when a ticket was closed has to say which range each pair
   * belongs to.
   */
  fromLabel?: string;
  /** Defaults to "To". */
  toLabel?: string;
  /**
   * Applied to each of the two fields.
   *
   * Each field separately rather than to a wrapper, because there is no
   * wrapper: see the note on the fragment below.
   */
  fieldSx?: SxProps<Theme>;
  /**
   * Let each field fill the width it is given.
   *
   * False by default, which suits a flex row that sizes its children with
   * `flex`/`minWidth` through `fieldSx`. A caller laying the bar out with
   * `FilterRow` wants the opposite: there the grid column decides the width,
   * and `FilterRow`'s own note asks the controls inside it not to.
   *
   * Stated rather than inherited for the same reason as the size below — the
   * theme's `fullWidth: true` does not reach a picker's field, so leaving this
   * out would not give a grid caller the house behaviour, it would give it a
   * shrink-wrapped field in a wide column.
   */
  fullWidth?: boolean;
}

/**
 * The two ends of a date range, as calendar pickers.
 *
 * Shared because three filter bars ask the same question — the admin
 * dashboard's custom range, one engineer's period, and the ticket lists'
 * "reported between" — and the thing worth sharing is not the markup but the
 * **value contract**: two `YYYY-MM-DD` strings in, two out, and nothing written
 * while a date is still being typed. Each caller stores its range differently
 * (the dashboard keeps days, the ticket list keeps full ISO instants) and
 * converts at its own edge, so the conversion lives in one place per caller
 * rather than in this component under a flag.
 *
 * **No `Dayjs` crosses this boundary.** The date library is an implementation
 * detail of the picker; the moment one of its objects reaches a caller, every
 * caller has to reason about timezones and about which library the project
 * uses. Parsing in and formatting out costs two lines and keeps that contained.
 *
 * **A fragment, not a box.** The two fields are siblings in whatever layout the
 * caller is running — flex row here, CSS grid in the ticket list — and a
 * wrapper would make them one item of it, so a grid caller would get two fields
 * crammed into one column.
 *
 * **`size="small"` is set here on purpose, and the reason is not the obvious
 * one.** `theme.ts` gives every `MuiTextField` `{ fullWidth: true, size:
 * 'medium' }`, and the expectation is that the picker inherits it. It does
 * not: the field slot renders `MuiPickersTextField`, a different component
 * from `MuiTextField`, so nothing keyed on the latter — `defaultProps`,
 * `styleOverrides`, `variants` — reaches a picker at all. Verified by reading
 * the rendered classes with and without this line; without it the input
 * carries no size class and lands on medium, the picker's own default. The
 * effect is the same either way, which is what makes it worth writing down:
 * the field would have stood a whole size step taller than the small selects
 * beside it, and the fix a reader would reach for first — adjusting the theme
 * — would have done nothing.
 *
 * It is not a prop because no filter bar wants anything else. When one does,
 * this is the line to change.
 */
export function DateRangeFields({
  from,
  to,
  onChange,
  fromLabel = 'From',
  toLabel = 'To',
  fieldSx,
  fullWidth = false,
}: DateRangeFieldsProps) {
  const fieldProps = { size: 'small', fullWidth, sx: fieldSx } as const;
  const [fromDraft, setFromDraft] = useDraft(from);
  const [toDraft, setToDraft] = useDraft(to);

  /**
   * Write one end out, unless the picker is mid-edit.
   *
   * Half-finished dates reach this handler, and the ugly case is not the
   * obvious one. A field left at "12/--/----" fires nothing at all — Material
   * UI withholds the change until every section has a value — but a reader
   * typing the year of 03/12/2026 fills the last section four times, and
   * years 2, 20 and 202 are all perfectly real dates. Written through, each
   * would land in the address bar and send the dashboard's eight reports off
   * to the third century on the way to the one the reader meant.
   */
  const commit = (end: 'from' | 'to', value: Dayjs | null, error: DateValidationError): void => {
    const next = serialise(value, error);
    if (next === null) {
      return;
    }
    onChange(end === 'from' ? { from: next } : { to: next });
  };

  return (
    <>
      <DatePicker
        label={fromLabel}
        format={FIELD_FORMAT}
        value={fromDraft}
        onChange={(value, context) => {
          setFromDraft(value);
          commit('from', value, context.validationError);
        }}
        slotProps={{ textField: fieldProps }}
      />
      <DatePicker
        label={toLabel}
        format={FIELD_FORMAT}
        value={toDraft}
        onChange={(value, context) => {
          setToDraft(value);
          commit('to', value, context.validationError);
        }}
        slotProps={{ textField: fieldProps }}
      />
    </>
  );
}

/**
 * What one field is currently showing, which is not always what is stored.
 *
 * The two differ for exactly as long as a date is being typed, and the
 * difference is the whole reason this hook exists. A field driven straight
 * from the stored string is reset by Material UI the moment a change is
 * refused — so refusing year 202 on the way to 2026 wiped the month and the
 * day the reader had already entered, and the date could never be finished.
 * Holding the half-typed value here lets the field show every keystroke while
 * the caller is told only about the ones that are dates.
 *
 * Resynchronised **during render** rather than from an effect, which is the
 * same pattern as `IncidentFilterBar`'s search box: React re-runs the
 * component before touching the DOM, so there is no frame showing the old
 * date and no second render pass to pay for. The comparison is on the stored
 * string, because a fresh `Dayjs` is a new object on every render and would
 * resynchronise for ever.
 */
function useDraft(stored: string): [Dayjs | null, (next: Dayjs | null) => void] {
  const [draft, setDraft] = useState<Dayjs | null>(() => parse(stored));
  const [lastStored, setLastStored] = useState(stored);

  if (stored !== lastStored) {
    setLastStored(stored);
    setDraft(parse(stored));
  }

  return [draft, setDraft];
}

/**
 * A picked date as the string a caller stores.
 *
 * Three outcomes, and the third is the one that matters: `''` for a field the
 * reader cleared, the day for a date they finished choosing, and `null` for
 * "not a date yet — say nothing".
 *
 * The verdict is the picker's own rather than a rule invented here. Material
 * UI hands every change a `validationError`, and the adapter's default bounds
 * — 1 January 1900 to 31 December 2099 — are what reject a year still being
 * typed. Re-deriving that here would be a second copy of a rule that already
 * has a home, and a copy that would not know about a `minDate` a caller sets
 * later.
 */
function serialise(value: Dayjs | null, error: DateValidationError): string | null {
  if (error !== null) {
    return null;
  }
  if (value === null) {
    return '';
  }
  return value.format(DAY_FORMAT);
}

/**
 * A stored string as the picker's value.
 *
 * Anything unparseable becomes an empty field rather than an error state: these
 * strings arrive from the query string, where they can be whatever was pasted,
 * and "the date you asked for is malformed" is not something a reader looking
 * at a filter bar can act on. An empty field says the same thing in a form they
 * can — they pick one.
 */
function parse(value: string): Dayjs | null {
  if (!value) {
    return null;
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed : null;
}
