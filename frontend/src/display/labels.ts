import type {
  AvailabilityStatus,
  BlockedReasonType,
  CloseReason,
  EventType,
  IncidentPriority,
  IncidentStatus,
  LocationDetail,
  NoteVisibility,
  SeatType,
} from '../api/types';

/**
 * How every domain enum is worded for a human.
 *
 * The API speaks in `SCREAMING_SNAKE_CASE` because that is what a PostgreSQL
 * enum is. Nobody should read that on a screen, and nobody should have to
 * write `.replace('_', ' ')` at a dozen call sites either — a mapping in one
 * module means "Waiting on parts" is spelled the same way everywhere, and a
 * new enum member is a compile error here rather than a raw token on a page.
 *
 * `Record<Enum, string>` is what produces that error: adding a member to a
 * union without adding its wording fails the type check.
 */

const STATUS_LABELS: Record<IncidentStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  BLOCKED: 'Blocked',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

const PRIORITY_LABELS: Record<IncidentPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

const BLOCKED_REASON_LABELS: Record<BlockedReasonType, string> = {
  WAITING_ON_PARTS: 'Waiting on parts',
  WAITING_ON_EMPLOYEE: 'Waiting on the employee',
  WAITING_ON_VENDOR: 'Waiting on a vendor',
  ACCESS_REQUIRED: 'Access required',
  OTHER: 'Something else',
};

const CLOSE_REASON_LABELS: Record<CloseReason, string> = {
  CONFIRMED_FIXED: 'Confirmed fixed',
  CLOSED_BY_ENGINEER: 'Closed by the engineer',
  DUPLICATE: 'Duplicate of another ticket',
  INVALID: 'Not a valid issue',
  CANCELLED_BY_REPORTER: 'Cancelled by the reporter',
  ADMIN_CLOSED: 'Closed by a facility admin',
};

const AVAILABILITY_LABELS: Record<AvailabilityStatus, string> = {
  AVAILABLE: 'Available',
  BUSY: 'Busy',
  OFF_DUTY: 'Off duty',
  ON_LEAVE: 'On leave',
};

const SEAT_TYPE_LABELS: Record<SeatType, string> = {
  DESK: 'Desk',
  MEETING_ROOM: 'Meeting room',
  COMMON_AREA: 'Common area',
  OTHER: 'Other',
};

const VISIBILITY_LABELS: Record<NoteVisibility, string> = {
  PUBLIC: 'Everyone on this ticket',
  INTERNAL: 'Staff only',
};

/**
 * How each audit event is narrated in the timeline.
 *
 * Past tense and impersonal, because the actor's name is rendered beside it:
 * "Priya Raman — Assigned".
 */
const EVENT_LABELS: Record<EventType, string> = {
  CREATED: 'Reported',
  STATUS_CHANGED: 'Status changed',
  ASSIGNED: 'Assigned',
  UNASSIGNED: 'Unassigned',
  PRIORITY_CHANGED: 'Priority changed',
  ESCALATED: 'Escalated',
  ESCALATION_CLEARED: 'Escalation cleared',
  NOTE_ADDED: 'Note added',
  MARKED_DUPLICATE: 'Marked as a duplicate',
  REOPENED: 'Reopened',
};

/**
 * What each priority means in plain language.
 *
 * Shown on the questionnaire's priority cards, straight from the build plan.
 * Everyone thinks their own problem is urgent; a hint is what makes the four
 * levels mean the same thing to two different reporters.
 */
const PRIORITY_HINTS: Record<IncidentPriority, string> = {
  LOW: 'Minor, can wait a few days',
  MEDIUM: 'Annoying, but I can still work',
  HIGH: "I can't do part of my job",
  CRITICAL: 'Safety hazard, or many people are blocked',
};

/** Every status, in workflow order. */
export const INCIDENT_STATUSES: IncidentStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'BLOCKED',
  'RESOLVED',
  'CLOSED',
];

/** Every priority, most urgent first — the order a filter should offer them. */
export const INCIDENT_PRIORITIES: IncidentPriority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

/** Every blocked reason, in the order the dialog offers them. */
export const BLOCKED_REASON_TYPES: BlockedReasonType[] = [
  'WAITING_ON_PARTS',
  'WAITING_ON_EMPLOYEE',
  'WAITING_ON_VENDOR',
  'ACCESS_REQUIRED',
  'OTHER',
];

/** Every availability state an engineer can set. */
export const AVAILABILITY_STATUSES: AvailabilityStatus[] = [
  'AVAILABLE',
  'BUSY',
  'OFF_DUTY',
  'ON_LEAVE',
];

/** Every seat type, in the order the facilities screen offers them. */
export const SEAT_TYPES: SeatType[] = ['DESK', 'MEETING_ROOM', 'COMMON_AREA', 'OTHER'];

/** Every location precision a category group can require. */
export const LOCATION_DETAILS: LocationDetail[] = ['BUILDING', 'FLOOR', 'SEAT'];

export function statusLabel(status: IncidentStatus): string {
  return STATUS_LABELS[status];
}

export function priorityLabel(priority: IncidentPriority): string {
  return PRIORITY_LABELS[priority];
}

export function priorityHint(priority: IncidentPriority): string {
  return PRIORITY_HINTS[priority];
}

export function blockedReasonLabel(reason: BlockedReasonType): string {
  return BLOCKED_REASON_LABELS[reason];
}

export function closeReasonLabel(reason: CloseReason): string {
  return CLOSE_REASON_LABELS[reason];
}

export function availabilityLabel(availability: AvailabilityStatus): string {
  return AVAILABILITY_LABELS[availability];
}

export function seatTypeLabel(seatType: SeatType): string {
  return SEAT_TYPE_LABELS[seatType];
}

export function visibilityLabel(visibility: NoteVisibility): string {
  return VISIBILITY_LABELS[visibility];
}

export function eventLabel(eventType: EventType): string {
  return EVENT_LABELS[eventType];
}

/**
 * Describe what a category group needs to know about where a problem is.
 *
 * Used on the Categories admin screen, where `location_detail` is the setting
 * that decides which inputs the questionnaire shows the reporter.
 */
export function locationDetailLabel(detail: LocationDetail): string {
  const labels: Record<LocationDetail, string> = {
    BUILDING: 'Building only',
    FLOOR: 'Building and floor',
    SEAT: 'Building, floor and desk',
  };
  return labels[detail];
}

/**
 * How a seat is labelled to a reporter for a given group.
 *
 * Meeting-room problems are reported against a room, not a desk, and calling
 * it "Seat" in that context reads as the wrong question.
 */
export function seatFieldLabel(groupName: string | null | undefined): string {
  return groupName?.toLowerCase().includes('meeting') ? 'Room' : 'Desk';
}
