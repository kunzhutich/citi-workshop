import { describe, expect, it } from 'vitest';

import { formatDate, formatDateTime, relativeTime } from './time';

/**
 * `relativeTime` takes `now` as an argument rather than reading the clock, so
 * these tests state the moment they measure from instead of arranging one.
 */
const NOW = new Date('2026-06-15T12:00:00Z');

/** An ISO timestamp the given number of milliseconds before `NOW`. */
function ago(milliseconds: number): string {
  return new Date(NOW.getTime() - milliseconds).toISOString();
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  it('says "just now" for anything under a minute', () => {
    expect(relativeTime(ago(0), NOW)).toBe('just now');
    expect(relativeTime(ago(59_000), NOW)).toBe('just now');
  });

  it('counts whole minutes up to an hour', () => {
    expect(relativeTime(ago(MINUTE), NOW)).toBe('1m ago');
    expect(relativeTime(ago(59 * MINUTE), NOW)).toBe('59m ago');
  });

  it('counts whole hours up to a day', () => {
    expect(relativeTime(ago(HOUR), NOW)).toBe('1h ago');
    expect(relativeTime(ago(23 * HOUR), NOW)).toBe('23h ago');
  });

  it('counts whole days up to a month', () => {
    expect(relativeTime(ago(DAY), NOW)).toBe('1d ago');
    expect(relativeTime(ago(29 * DAY), NOW)).toBe('29d ago');
  });

  it('falls back to a date once the elapsed time stops being useful', () => {
    // "94d ago" is a number nobody converts; a date is read directly.
    expect(relativeTime(ago(94 * DAY), NOW)).toMatch(/2026/);
  });

  it('returns nothing for a value that is not a timestamp', () => {
    expect(relativeTime('not a date', NOW)).toBe('');
  });
});

describe('formatDateTime and formatDate', () => {
  it('render an em dash for an absent timestamp', () => {
    // Every nullable timestamp on a ticket goes through these — `resolved_at`
    // on an open ticket, `closed_at` on anything unfinished.
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
    expect(formatDate(null)).toBe('—');
  });

  it('render an em dash rather than "Invalid Date"', () => {
    expect(formatDateTime('nonsense')).toBe('—');
    expect(formatDate('nonsense')).toBe('—');
  });

  it('include the year, month and day', () => {
    expect(formatDate('2026-06-15T12:00:00Z')).toMatch(/2026/);
    expect(formatDateTime('2026-06-15T12:00:00Z')).toMatch(/2026/);
  });
});
