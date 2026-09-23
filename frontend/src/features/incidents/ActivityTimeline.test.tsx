import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ActivityEntry } from '../../api/types';
import { renderWithAuth } from '../../test/renderWithProviders';
import { ActivityTimeline } from './ActivityTimeline';

/**
 * How a ticket's history reads.
 *
 * Note visibility is **not** tested here, and deliberately: an employee's
 * `/activity` response contains no INTERNAL notes to hide, because
 * `services/visibility.py` filters them in the query. This component styles
 * what it is given. Who may be given what is a backend test.
 */

function event(overrides: Partial<ActivityEntry>): ActivityEntry {
  return {
    kind: 'event',
    id: 'e1',
    created_at: new Date().toISOString(),
    actor: {
      id: 'u1',
      full_name: 'Sam Senior',
      email: 'sam@acme.inc',
      role: 'ENGINEER',
    },
    event_type: 'STATUS_CHANGED',
    from_value: null,
    to_value: null,
    from_label: null,
    to_label: null,
    reason: null,
    body: null,
    visibility: null,
    edited_at: null,
    ...overrides,
  };
}

function note(overrides: Partial<ActivityEntry>): ActivityEntry {
  return { ...event({}), kind: 'note', id: 'n1', event_type: null, ...overrides };
}

describe('events', () => {
  it('says so when nothing has happened', () => {
    renderWithAuth(<ActivityTimeline entries={[]} />);

    expect(screen.getByText('Nothing has happened to this ticket yet.')).toBeInTheDocument();
  });

  it('reads a status change in words, not enum members', () => {
    renderWithAuth(
      <ActivityTimeline
        entries={[event({ from_value: 'BLOCKED', to_value: 'IN_PROGRESS' })]}
      />,
    );

    expect(screen.getByText('Status changed: Blocked → In progress')).toBeInTheDocument();
  });

  it('names the assignee instead of printing their id', () => {
    // The defect this exists for: the detail page read
    // "Assigned: f6ac2cf4-0330-415e-a327-0af55964e5d6". The event records an
    // id, which is right for an audit row; the API resolves the name.
    renderWithAuth(
      <ActivityTimeline
        entries={[
          event({
            event_type: 'ASSIGNED',
            to_value: 'f6ac2cf4-0330-415e-a327-0af55964e5d6',
            to_label: 'Priya Raman',
          }),
        ]}
      />,
    );

    expect(screen.getByText('Assigned: Priya Raman')).toBeInTheDocument();
    expect(screen.queryByText(/f6ac2cf4/)).not.toBeInTheDocument();
  });

  it('names both ends of a reassignment', () => {
    renderWithAuth(
      <ActivityTimeline
        entries={[
          event({
            event_type: 'ASSIGNED',
            from_value: 'id-1',
            to_value: 'id-2',
            from_label: 'Priya Raman',
            to_label: 'Marcus Webb',
          }),
        ]}
      />,
    );

    expect(screen.getByText('Assigned: Priya Raman → Marcus Webb')).toBeInTheDocument();
  });

  it('shows who a ticket was taken from when it is unassigned', () => {
    renderWithAuth(
      <ActivityTimeline
        entries={[
          event({ event_type: 'UNASSIGNED', from_value: 'id-1', from_label: 'Priya Raman' }),
        ]}
      />,
    );

    expect(screen.getByText('Unassigned: Priya Raman')).toBeInTheDocument();
  });

  it('shows the reason a move was made', () => {
    renderWithAuth(
      <ActivityTimeline
        entries={[
          event({
            event_type: 'REOPENED',
            from_value: 'CLOSED',
            to_value: 'IN_PROGRESS',
            reason: 'It started flickering again two hours later.',
          }),
        ]}
      />,
    );

    expect(screen.getByText('Reopened: Closed → In progress')).toBeInTheDocument();
    expect(
      screen.getByText('It started flickering again two hours later.'),
    ).toBeInTheDocument();
  });

  it('attributes a system entry to nobody in particular', () => {
    renderWithAuth(<ActivityTimeline entries={[event({ actor: null })]} />);

    expect(screen.getByText('System')).toBeInTheDocument();
  });
});

describe('notes', () => {
  it('shows a public note without a visibility label', () => {
    renderWithAuth(
      <ActivityTimeline
        entries={[note({ body: 'The new panel arrived.', visibility: 'PUBLIC' })]}
      />,
    );

    expect(screen.getByText('The new panel arrived.')).toBeInTheDocument();
    expect(screen.queryByText('Internal')).not.toBeInTheDocument();
  });

  it('labels a staff-only note, so nobody mistakes it for one the reporter read', () => {
    renderWithAuth(
      <ActivityTimeline
        entries={[note({ body: 'Third failure on this batch.', visibility: 'INTERNAL' })]}
      />,
    );

    expect(screen.getByText('Third failure on this batch.')).toBeInTheDocument();
    expect(screen.getByText('Internal')).toBeInTheDocument();
  });

  it('says when a note was edited', () => {
    renderWithAuth(
      <ActivityTimeline
        entries={[
          note({
            body: 'Corrected.',
            visibility: 'PUBLIC',
            edited_at: new Date(Date.now() - 3 * 60_000).toISOString(),
          }),
        ]}
      />,
    );

    expect(screen.getByText(/edited 3m ago/)).toBeInTheDocument();
  });
});
