import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { apiError } from '../../test/apiError';
import { makeTransition } from '../../test/factories';
import { renderWithAuth } from '../../test/renderWithProviders';
import { TransitionDialog } from './TransitionDialog';

/**
 * The dialog is built from `required_fields` and from nothing else.
 *
 * These tests never name a transition. They hand the component a list of
 * field names and assert which inputs appear — which is the whole contract,
 * and the reason adding a field to a row of `app/workflow.py` needs no React
 * change.
 */

function renderDialog(
  requiredFields: string[],
  options: { onSubmit?: () => Promise<unknown>; closeReasons?: string[] } = {},
) {
  const onSubmit = options.onSubmit ?? vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  const transition = makeTransition('RESOLVED', 'Resolve', {
    required_fields: requiredFields,
    close_reason_choices: (options.closeReasons ?? []) as never,
  });

  renderWithAuth(
    <TransitionDialog
      open
      onClose={onClose}
      transition={transition}
      onSubmit={onSubmit}
      isSubmitting={false}
    />,
  );

  return { onSubmit, onClose };
}

describe('TransitionDialog', () => {
  it('asks for nothing when the transition requires nothing', () => {
    renderDialog([]);

    expect(screen.getByText(/needs nothing else from you/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('asks for a resolution summary, and only that', () => {
    renderDialog(['resolution_summary']);

    expect(screen.getByLabelText(/What did you do\?/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Why\?/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/What is it waiting on\?/)).not.toBeInTheDocument();
  });

  it('asks for a reason, and only that', () => {
    renderDialog(['reason']);

    expect(screen.getByLabelText(/Why\?/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/What did you do\?/)).not.toBeInTheDocument();
  });

  it('asks for both halves of a block reason', () => {
    renderDialog(['blocked_reason_type', 'blocked_reason']);

    expect(screen.getByLabelText(/What is it waiting on\?/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Details/)).toBeInTheDocument();
  });

  it('offers exactly the close reasons the API listed', async () => {
    renderDialog(['close_reason'], { closeReasons: ['DUPLICATE', 'INVALID'] });

    await userEvent.click(screen.getByLabelText(/Why is it being closed\?/));

    expect(screen.getByRole('option', { name: 'Duplicate of another ticket' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Not a valid issue' })).toBeInTheDocument();
    // Not offered, because this transition's row does not record it.
    expect(screen.queryByRole('option', { name: 'Confirmed fixed' })).not.toBeInTheDocument();
  });

  it('reveals the duplicate field only when DUPLICATE is chosen', async () => {
    renderDialog(['close_reason'], { closeReasons: ['DUPLICATE', 'INVALID'] });

    expect(screen.queryByLabelText(/Duplicate of/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/Why is it being closed\?/));
    await userEvent.click(screen.getByRole('option', { name: 'Not a valid issue' }));
    expect(screen.queryByLabelText(/Duplicate of/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/Why is it being closed\?/));
    await userEvent.click(screen.getByRole('option', { name: 'Duplicate of another ticket' }));
    expect(screen.getByLabelText(/Duplicate of/)).toBeInTheDocument();
  });

  it('sends only the fields the transition asked for', async () => {
    const { onSubmit } = renderDialog(['resolution_summary']);

    await userEvent.type(screen.getByLabelText(/What did you do\?/), 'Replaced the panel.');
    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        to_status: 'RESOLVED',
        resolution_summary: 'Replaced the panel.',
      });
    });
  });

  it('attaches the API refusal to the input the API named', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(
        apiError(422, {
          detail: "'resolution_summary' is required to resolve.",
          code: 'TRANSITION_FIELD_REQUIRED',
          field: 'resolution_summary',
        }),
      );
    renderDialog(['resolution_summary'], { onSubmit });

    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    expect(
      await screen.findAllByText("'resolution_summary' is required to resolve."),
    ).not.toHaveLength(0);
  });

  it('closes itself once the transition succeeds', async () => {
    const { onClose } = renderDialog([]);

    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('stays open when the transition is refused', async () => {
    const onSubmit = vi.fn().mockRejectedValue(apiError(409, { detail: 'Not allowed now.' }));
    const { onClose } = renderDialog([], { onSubmit });

    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    expect(await screen.findByText('Not allowed now.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
