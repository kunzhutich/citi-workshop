/**
 * Rendering the API's timestamps.
 *
 * Every timestamp crosses the wire as an ISO-8601 UTC string. These helpers
 * turn one into what a person reads: "2h ago" in a list, a full local date and
 * time on a detail page.
 *
 * `now` is a parameter rather than a call to `Date.now()` inside, so a test can
 * state the moment it is measuring from instead of arranging for one.
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
