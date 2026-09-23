import { describe, expect, it } from 'vitest';

import type { IncidentStatus } from '../api/types';
import {
  AVAILABILITY_STATUSES,
  BLOCKED_REASON_TYPES,
  INCIDENT_PRIORITIES,
  INCIDENT_STATUSES,
  blockedReasonLabel,
  closeReasonLabel,
  priorityHint,
  priorityLabel,
  seatFieldLabel,
  statusLabel,
} from './labels';
import { statusChipColor, transitionButtonColor } from './statusColor';

describe('labels', () => {
  it('never shows a raw enum member to a person', () => {
    const everything = [
      ...INCIDENT_STATUSES.map(statusLabel),
      ...INCIDENT_PRIORITIES.map(priorityLabel),
      ...BLOCKED_REASON_TYPES.map(blockedReasonLabel),
      closeReasonLabel('CONFIRMED_FIXED'),
      closeReasonLabel('CANCELLED_BY_REPORTER'),
    ];

    for (const label of everything) {
      expect(label).not.toMatch(/_/);
      expect(label).not.toBe(label.toUpperCase());
    }
  });

  it('lists the priorities most urgent first, which is the order a filter offers', () => {
    expect(INCIDENT_PRIORITIES[0]).toBe('CRITICAL');
    expect(INCIDENT_PRIORITIES.at(-1)).toBe('LOW');
  });

  it('lists the statuses in workflow order', () => {
    expect(INCIDENT_STATUSES).toEqual([
      'OPEN',
      'IN_PROGRESS',
      'BLOCKED',
      'RESOLVED',
      'CLOSED',
    ]);
  });

  it('gives every priority a plain-language hint', () => {
    for (const priority of INCIDENT_PRIORITIES) {
      expect(priorityHint(priority).length).toBeGreaterThan(10);
    }
  });

  it('offers every availability state an engineer can set', () => {
    expect(AVAILABILITY_STATUSES).toContain('AVAILABLE');
    expect(AVAILABILITY_STATUSES).toContain('ON_LEAVE');
  });
});

describe('seatFieldLabel', () => {
  it('calls it a Room for meeting rooms and a Desk for everything else', () => {
    // Reporting a projector fault against a "Desk" is the wrong question, and
    // this is the only place that decides which word the form uses.
    expect(seatFieldLabel('Meeting Rooms')).toBe('Room');
    expect(seatFieldLabel('meeting rooms')).toBe('Room');
    expect(seatFieldLabel('Hardware')).toBe('Desk');
    expect(seatFieldLabel(null)).toBe('Desk');
    expect(seatFieldLabel(undefined)).toBe('Desk');
  });
});

describe('statusChipColor', () => {
  it('follows the palette from the build plan', () => {
    const expected: Record<IncidentStatus, string> = {
      OPEN: 'info',
      IN_PROGRESS: 'primary',
      BLOCKED: 'warning',
      RESOLVED: 'success',
      CLOSED: 'default',
    };
    for (const status of INCIDENT_STATUSES) {
      expect(statusChipColor(status)).toBe(expected[status]);
    }
  });
});

describe('transitionButtonColor', () => {
  it('colours the two destinations that mean the same thing to everyone', () => {
    // "Resolve" is always "I have fixed it" and "Mark blocked" is always
    // "this has stalled", so the button can be coloured like its outcome.
    expect(transitionButtonColor('RESOLVED')).toBe('success');
    expect(transitionButtonColor('BLOCKED')).toBe('warning');
  });

  it('leaves CLOSED plain rather than confidently wrong', () => {
    // RESOLVED -> CLOSED is "Confirm fixed" to a reporter and "Close ticket"
    // to the assignee; OPEN -> CLOSED is "Cancel ticket". A happy path and a
    // discard share a destination, and telling them apart would mean the UI
    // keeping its own copy of `app/workflow.py`.
    expect(transitionButtonColor('CLOSED')).toBe('primary');
  });

  it('never returns a colour a button cannot take', () => {
    // `default` is a chip colour and not a button one, which is why these are
    // two functions rather than one shared table.
    for (const status of INCIDENT_STATUSES) {
      expect(transitionButtonColor(status)).not.toBe('default');
    }
  });
});
