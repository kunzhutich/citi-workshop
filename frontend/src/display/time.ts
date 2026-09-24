/**
 * Rendering the API's timestamps.
 *
 * Every timestamp crosses the wire as an ISO-8601 UTC string. These helpers
 * turn one into what a person reads: "2h ago" in a list, a full local date and
 * time on a detail page.
 *
 * `now` is a parameter rather than a call to `Date.now()` inside, so a test can
 * state the moment it is measuring from instead of arranging for one.
 *
 * The last three functions go the other way and are not rendering at all: they
 * convert between an instant and the calendar day it falls on, which is the
 * arithmetic a date picker forces on any filter whose API takes instants. They
 * live here because the rule they all depend on — that a calendar day means
 * local midnight and not UTC midnight — is `parseCalendarDay`'s, and a second
 * copy of that rule is exactly the off-by-one day its comment describes.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Describe how long ago a timestamp was, in the shortest form that is honest.
 *
 * Deliberately coarse: "3d ago" rather than "3 days, 4 hours ago". A list row
 * is answering "is this stale?", and a reader decides that from the magnitude.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const elapsed = now.getTime() - then.getTime();

  if (Number.isNaN(elapsed)) {
    return '';
  }
  if (elapsed < MINUTE) {
    return 'just now';
  }
  if (elapsed < HOUR) {
    return `${Math.floor(elapsed / MINUTE)}m ago`;
  }
  if (elapsed < DAY) {
    return `${Math.floor(elapsed / HOUR)}h ago`;
  }
  if (elapsed < 30 * DAY) {
    return `${Math.floor(elapsed / DAY)}d ago`;
  }
  return formatDate(iso);
}

/** A timestamp as a local date and time, for a detail page. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) {
    return '—';
  }
  return value.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** A timestamp as a local date alone. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) {
    return '—';
  }
  return value.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * A duration in hours as something a person reads.
 *
 * The reports return every duration in hours — a median time to resolve, how
 * long a ticket has been blocked — and past a day that unit stops being
 * readable: "777.4h" is a number nobody converts in their head, while "32d" is
 * the fact being reported. Under a day it stays in hours, where the precision
 * is the point.
 *
 * `null` is not zero and must not render as one. The API returns `null` when
 * nothing in the population reached the milestone being measured — no ticket
 * was resolved, nothing is blocked — and "0h" would claim it happened
 * instantly.
 */
export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) {
    return '—';
  }
  if (hours < 24) {
    return `${Math.round(hours)}h`;
  }
  return `${Math.round(hours / 24)}d`;
}

/**
 * A calendar day, as the reports' `per_day` series spells it.
 *
 * **Not `new Date(day)`.** ECMAScript parses a bare `YYYY-MM-DD` as UTC
 * midnight, and `toLocaleDateString` then renders it in the reader's zone — so
 * in any zone west of Greenwich every label came out a day early. The
 * daily-flow chart's axis began at "Sep 15" for a window the heading said
 * started on Sep 16, which looks like an off-by-one in the *data* and is
 * really one in the parse. Appending a time makes the same string parse as
 * **local** midnight, which is what a calendar day from a report means: the
 * server grouped by date, not by instant.
 *
 * A full ISO timestamp is left alone — `created_at` and friends carry a zone
 * and must keep it.
 */
export function parseCalendarDay(day: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00`) : new Date(day);
}

/** A calendar day as "23 Sep" — what an axis tick has room for. */
export function formatDayShort(day: string): string {
  return parseCalendarDay(day).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

/** A calendar day as "23 Sep 2026" — what a tooltip has room to say in full. */
export function formatDayLong(day: string): string {
  return parseCalendarDay(day).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * A calendar day as the instant its local day begins.
 *
 * For a filter that is stored as an instant but asked for as a day. The ticket
 * list's `created_from` is one: the same parameter carries a dashboard window
 * computed to the second, and the API compares it against `created_at` with
 * `>=`. Someone who picks 23 September means that day from its first minute in
 * their own zone, so the day is resolved through `parseCalendarDay` rather than
 * by pasting `T00:00:00Z` on the end of it.
 *
 * `useDashboardFilters.ts` had two private functions of this shape, written
 * before this module had these, and now calls these instead. It keeps a guard
 * of its own around them: its two ends come out of the address bar, where a
 * hand-edit can leave something that is not a date, and these helpers throw on
 * one rather than guessing. Deciding what an unreadable filter means belongs
 * to the query being built, not to the arithmetic.
 */
export function startOfDayInstant(day: string): string {
  return parseCalendarDay(day).toISOString();
}

/**
 * A calendar day as the last instant of its local day.
 *
 * The milliseconds are the point. `created_to` is compared with `<=`, so a day
 * left at its own midnight would exclude every ticket reported during the day
 * the reader named — which is the day they were asking about.
 */
export function endOfDayInstant(day: string): string {
  const end = parseCalendarDay(day);
  end.setHours(23, 59, 59, 999);
  return end.toISOString();
}

/**
 * The local calendar day an instant falls on, as `YYYY-MM-DD`.
 *
 * The way back, for a date picker that has to show what a stored instant means.
 * **Not `iso.slice(0, 10)`, and not `toISOString().slice(0, 10)`** — both read
 * the UTC day, so a filter widened to a local day that began at 07:00 UTC comes
 * back as the day before in any zone east of Greenwich, and the picker would
 * show a date the reader never chose.
 *
 * `''` for anything unparseable, `''` included, because `''` is what a picker
 * takes for "no date". "The instant in your address bar is malformed" is not
 * something a reader looking at a filter bar can act on; an empty field says
 * the same thing in a form they can.
 */
export function calendarDayOf(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) {
    return '';
  }
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}
