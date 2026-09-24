import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { makeAdmin, makeEngineer, makeIncident, makeTransition, makeUser } from '../../test/factories';
import { renderWithAuth } from '../../test/renderWithProviders';
import { ActionsCard, type IncidentActionsProps } from './IncidentActions';

/**
 * The rule this file exists for: **the actions come from the API, not from
 * this code.** No role check, no status check, no table mapping a situation to
 * a button. Two inputs decide everything — `allowed-transitions` and the
 * `can_*` flags — and these tests hold that line.
 */

function renderActions(overrides: Partial<IncidentActionsProps> = {}) {
  const props: IncidentActionsProps = {
    incident: makeIncident(),
    transitions: [],
    user: makeUser(),
    onTransition: vi.fn(),
    onAssign: vi.fn(),
    onPickUp: vi.fn(),
    onEscalate: vi.fn(),
    onClearEscalation: vi.fn(),
    onChangePriority: vi.fn(),
    onEdit: vi.fn(),
    onGiveFeedback: vi.fn(),
    isPickingUp: false,
    ...overrides,
  };
  renderWithAuth(<ActionsCard {...props} />, { user: props.user });
  return props;
}

describe('workflow buttons', () => {
  it('draws one button per allowed transition, labelled by the API', () => {
    renderActions({
      transitions: [
        makeTransition('IN_PROGRESS', 'Start work'),
        makeTransition('CLOSED', 'Close ticket'),
      ],
    });

    expect(screen.getByRole('button', { name: 'Start work' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close ticket' })).toBeInTheDocument();
  });

  it('draws a label it has never seen before, because it does not know any', () => {
    // The proof that nothing here maps a status to a word: an action_label
    // invented by the backend renders unchanged.
    renderActions({ transitions: [makeTransition('CLOSED', 'Send to the archive')] });

    expect(screen.getByRole('button', { name: 'Send to the archive' })).toBeInTheDocument();
  });

  it('draws nothing when the API offers nothing, whatever the status', () => {
    renderActions({ incident: makeIncident({ status: 'IN_PROGRESS' }), transitions: [] });

    expect(screen.getByText('There is nothing for you to do on this ticket.')).toBeInTheDocument();
  });

  it('hands the whole transition back, so the dialog knows its required fields', async () => {
    const resolve = makeTransition('RESOLVED', 'Resolve', {
      required_fields: ['resolution_summary'],
    });
    const props = renderActions({ transitions: [resolve] });

    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    expect(props.onTransition).toHaveBeenCalledWith(resolve);
  });
});

describe('contextual actions', () => {
  it.each([
    ['can_edit', 'Edit'],
    ['can_change_priority', 'Change priority'],
    ['can_escalate', 'Escalate'],
  ] as const)('shows "%s" as "%s" only when the flag is set', (flag, label) => {
    renderActions();
    expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    cleanup();

    renderActions({ incident: makeIncident({ [flag]: true }) });
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  });

  it('shows "Clear escalation" only to someone the API says may clear one', () => {
    renderActions({ incident: makeIncident({ is_escalated: true, can_clear_escalation: true }) });

    expect(screen.getByRole('button', { name: 'Clear escalation' })).toBeInTheDocument();
  });
});

describe('the two spellings of assign', () => {
  it('offers an engineer "Pick up" on an unassigned ticket', () => {
    renderActions({
      incident: makeIncident({ can_assign: true, assignee: null }),
      user: makeEngineer('SENIOR'),
    });

    expect(screen.getByRole('button', { name: 'Pick up' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign…' })).toBeInTheDocument();
  });

  it('does not offer "Pick up" once someone owns it', () => {
    renderActions({
      incident: makeIncident({
        can_assign: true,
        assignee: {
          id: '99999999-9999-4999-8999-999999999999',
          full_name: 'Sam Senior',
          email: 'sam@acme.inc',
          role: 'ENGINEER',
        },
      }),
      user: makeEngineer('LEAD'),
    });

    expect(screen.queryByRole('button', { name: 'Pick up' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reassign…' })).toBeInTheDocument();
  });

  it('never offers an admin "Pick up", because an admin is not an engineer', () => {
    renderActions({ incident: makeIncident({ can_assign: true }), user: makeAdmin() });

    expect(screen.queryByRole('button', { name: 'Pick up' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign…' })).toBeInTheDocument();
  });

  it('offers neither when the API says the assignee cannot change', () => {
    // A JUNIOR engineer, or anyone at all on a closed ticket.
    renderActions({ incident: makeIncident({ can_assign: false }), user: makeEngineer('JUNIOR') });

    expect(screen.queryByRole('button', { name: 'Pick up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assign…' })).not.toBeInTheDocument();
  });
});
