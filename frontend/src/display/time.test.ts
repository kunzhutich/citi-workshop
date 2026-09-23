import { describe, expect, it } from 'vitest';

import {
  formatDate,
  formatDateTime,
  formatDayLong,
  formatDayShort,
  formatHours,
  parseCalendarDay,
  relativeTime,
} from './time';

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

describe('formatHours', () => {
  it('keeps a duration under a day in hours, where the precision matters', () => {
    expect(formatHours(4.28)).toBe('4h');
    expect(formatHours(23.4)).toBe('23h');
  });

  it('turns a longer one into days, because nobody reads 777h', () => {
    expect(formatHours(35.39)).toBe('1d');
    expect(formatHours(777.35)).toBe('32d');
  });

  it('renders nothing-happened as a dash, never as zero', () => {
    // The API returns null when no ticket reached the milestone being
    // measured. "0h" would claim it happened instantly, which is the opposite
    // of what null means.
    expect(formatHours(null)).toBe('—');
    expect(formatHours(undefined)).toBe('—');
  });

  it('still says 0h for a real zero', () => {
    expect(formatHours(0)).toBe('0h');
  });
});

describe('calendar days from the reports', () => {
  it('reads a bare date as the day it says, not the day before', () => {
    // `new Date('2026-09-16')` is UTC midnight, which renders as 15 September
    // anywhere west of Greenwich. The daily-flow axis began a day early
    // because of it, so the heading and the chart disagreed by one day.
    expect(formatDayShort('2026-09-16')).toBe('Sep 16');
    expect(formatDayLong('2026-09-16')).toBe('Sep 16, 2026');
  });

  it('holds at both ends of a month and of a year', () => {
    expect(formatDayShort('2026-01-01')).toBe('Jan 1');
    expect(formatDayShort('2026-12-31')).toBe('Dec 31');
    expect(formatDayShort('2026-03-01')).toBe('Mar 1');
  });

  it('parses to local midnight, which is what a grouped-by-date row means', () => {
    const parsed = parseCalendarDay('2026-09-16');
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(8);
    expect(parsed.getDate()).toBe(16);
    expect(parsed.getHours()).toBe(0);
  });

  it('leaves a full timestamp alone, zone and all', () => {
    // Only a date-only string is ambiguous. An instant already knows its zone
    // and must not be shifted into the reader's.
    const iso = '2026-09-16T23:30:00Z';
    expect(parseCalendarDay(iso).toISOString()).toBe(new Date(iso).toISOString());
  });
});
