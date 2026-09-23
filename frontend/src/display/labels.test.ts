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
import { statusButtonColor, statusChipColor } from './statusColor';

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

describe('statusColor', () => {
  it('gives a chip and a button the same colour for the same status', () => {
    // The point of sharing the palette: a button that moves a ticket to
    // Resolved is the green of the Resolved chip.
    const shared: IncidentStatus[] = ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'RESOLVED'];
    for (const status of shared) {
      expect(statusChipColor(status)).toBe(statusButtonColor(status));
    }
  });

  it('spells neutral the way each component needs', () => {
    // Material UI has no `default` button colour and no `inherit` chip colour,
    // which is the whole reason there are two functions.
    expect(statusChipColor('CLOSED')).toBe('default');
    expect(statusButtonColor('CLOSED')).toBe('inherit');
  });

  it('draws blocked as a warning, which is what the stepper reads', () => {
    expect(statusChipColor('BLOCKED')).toBe('warning');
    expect(statusChipColor('RESOLVED')).toBe('success');
  });
});
