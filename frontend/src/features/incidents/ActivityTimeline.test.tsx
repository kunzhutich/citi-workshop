import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

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
    rating: null,
    comment: null,
    rated_user: null,
    resolution_round: null,
    can_edit: null,
    edited_at: null,
    ...overrides,
  };
}

function note(overrides: Partial<ActivityEntry>): ActivityEntry {
  return { ...event({}), kind: 'note', id: 'n1', event_type: null, ...overrides };
}

function feedback(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    ...event({}),
    kind: 'feedback',
    id: 'f1',
    event_type: null,
    rating: 4,
    comment: 'Sorted the same afternoon.',
    rated_user: {
      id: 'u2',
      full_name: 'Sam Senior',
      email: 'sam@acme.inc',
      role: 'ENGINEER',
    },
    resolution_round: 1,
    can_edit: false,
    ...overrides,
  };
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

describe('feedback', () => {
  it('shows the score in words as well as in stars', () => {
    // jsdom has no layout, so the five glyphs are untestable and would be
    // meaningless to a screen reader anyway. The words are the assertion
    // because the words are what carries the meaning.
    renderWithAuth(
      <ActivityTimeline
        entries={[feedback({ rating: 4, comment: 'Back up within the hour.' })]}
      />,
    );

    expect(screen.getByText('4/5 — Fixed well')).toBeInTheDocument();
    expect(screen.getByText('Back up within the hour.')).toBeInTheDocument();
  });

  it('names the engineer the rating is about, who is not always the assignee', () => {
    // The whole reason `rated_user` is on the entry rather than being read off
    // the ticket: a resolved ticket can be reassigned, and the review stays
    // with whoever did the work.
    renderWithAuth(
      <ActivityTimeline
        entries={[
          feedback({
            rating: 2,
            comment: 'Came back the next morning.',
            rated_user: {
              id: 'u9',
              full_name: 'Priya Raman',
              email: 'priya@acme.inc',
              role: 'ENGINEER',
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText(/About Priya Raman/)).toBeInTheDocument();
  });

  it('says which repair it rates only once there has been more than one', () => {
    const { rerender } = renderWithAuth(
      <ActivityTimeline entries={[feedback({ resolution_round: 1 })]} />,
    );
    expect(screen.queryByText(/repair 1/)).not.toBeInTheDocument();

    rerender(<ActivityTimeline entries={[feedback({ resolution_round: 2 })]} />);
    expect(screen.getByText(/repair 2/)).toBeInTheDocument();
  });

  it('offers a correction only when the API says it is still possible', async () => {
    const onEditFeedback = vi.fn();
    const { rerender } = renderWithAuth(
      <ActivityTimeline
        entries={[feedback({ can_edit: false })]}
        onEditFeedback={onEditFeedback}
      />,
    );
    // The negative half, and it earns it: the same render with `can_edit`
    // true below produces the button, so this is not an empty page passing.
    expect(screen.queryByRole('button', { name: 'Change this' })).not.toBeInTheDocument();

    rerender(
      <ActivityTimeline entries={[feedback({ can_edit: true })]} onEditFeedback={onEditFeedback} />,
    );
    const button = screen.getByRole('button', { name: 'Change this' });
    await userEvent.click(button);

    expect(onEditFeedback).toHaveBeenCalledTimes(1);
    expect(onEditFeedback.mock.calls[0][0]).toMatchObject({ kind: 'feedback' });
  });

  it('draws no correction button when there is nowhere to open one', () => {
    // `can_edit` is true and `onEditFeedback` is absent. Without the second
    // half of that condition this would render a button that does nothing.
    renderWithAuth(<ActivityTimeline entries={[feedback({ can_edit: true })]} />);

    expect(screen.queryByRole('button', { name: 'Change this' })).not.toBeInTheDocument();
    expect(screen.getByText(/Fixed well/)).toBeInTheDocument();
  });
});
