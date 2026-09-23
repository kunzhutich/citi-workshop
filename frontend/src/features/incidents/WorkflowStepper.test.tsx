import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { renderWithAuth } from '../../test/renderWithProviders';
import { setViewportWidth } from '../../test/viewport';
import { WorkflowStepper } from './WorkflowStepper';

/**
 * The required workflow visualisation.
 *
 * These are assertions about the *model* the picture conveys — which step is
 * current, that blocked is not a fifth one, that a reopened ticket says so.
 * Whether the steps run across or down is a question about layout, which jsdom
 * cannot answer; `e2e/responsive.spec.ts` measures it in a browser.
 */
describe('WorkflowStepper', () => {
  // `setViewportWidth` must run before `render`, not after — see M5's note on
  // react-responsive capturing `matchMedia` at import time.
  beforeEach(() => {
    setViewportWidth(1440);
  });

  it('shows exactly four steps, and blocked is not one of them', () => {
    renderWithAuth(<WorkflowStepper status="OPEN" />);

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.queryByText('Blocked')).not.toBeInTheDocument();
  });

  it.each([
    ['OPEN', 'Open'],
    ['IN_PROGRESS', 'In progress'],
    ['RESOLVED', 'Resolved'],
    ['CLOSED', 'Closed'],
  ] as const)('marks the %s step as current', (status, label) => {
    renderWithAuth(<WorkflowStepper status={status} />);

    // MUI marks the active step's label; the step's own text is what a person
    // reads, so that is what is asserted to exist.
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('turns the In progress step into Blocked, with the reason under it', () => {
    renderWithAuth(
      <WorkflowStepper
        status="BLOCKED"
        blockedReasonType="WAITING_ON_PARTS"
        blockedReason="Replacement panel due Thursday."
      />,
    );

    // The second step wears the block; it is not appended as a fifth.
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.queryByText('In progress')).not.toBeInTheDocument();
    expect(screen.getByText(/Waiting on parts/)).toBeInTheDocument();
    expect(screen.getByText(/Replacement panel due Thursday/)).toBeInTheDocument();
  });

  it('says nothing about reopening on a ticket that has not been', () => {
    renderWithAuth(<WorkflowStepper status="IN_PROGRESS" reopenCount={0} />);

    expect(screen.queryByText(/Reopened/)).not.toBeInTheDocument();
  });

  it('counts reopenings, because the four steps cannot show them', () => {
    // A twice-reopened ticket sitting at "In progress" looks, from the steps
    // alone, like one nobody has ever finished.
    renderWithAuth(<WorkflowStepper status="IN_PROGRESS" reopenCount={2} />);

    expect(screen.getByText('Reopened ×2')).toBeInTheDocument();
  });

  it('renders the same four steps at a phone width', () => {
    setViewportWidth(375);
    renderWithAuth(<WorkflowStepper status="RESOLVED" />);

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Closed')).toBeInTheDocument();
  });
});
