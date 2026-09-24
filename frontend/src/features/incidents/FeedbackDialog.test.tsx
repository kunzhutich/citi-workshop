import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithAuth } from '../../test/renderWithProviders';
import { FeedbackDialog } from './FeedbackDialog';

/**
 * The rating dialog.
 *
 * **What jsdom can and cannot say about it.** It has no layout, so nothing
 * here asserts where the stars sit, how wide the dialog is, or that picking a
 * score does not shift the comment field under the pointer — that last one is
 * the reason `SCORE_WORDING`'s line reserves its height, and it was checked in
 * a browser at 1440 and 375 rather than here.
 *
 * What jsdom *is* good for is the rule the owner cares about: **a rating
 * cannot be sent without words**, at every score including five. That is a
 * statement about which control is disabled when, and it needs no pixels.
 */

function render(overrides: Partial<Parameters<typeof FeedbackDialog>[0]> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  const props = {
    open: true,
    onClose,
    onSubmit,
    isSubmitting: false,
    engineerName: 'Sam Senior',
    ...overrides,
  };
  renderWithAuth(<FeedbackDialog {...props} />);
  return { onSubmit, onClose };
}

/**
 * Choose a score, and prove it was chosen.
 *
 * **`fireEvent` rather than `userEvent`, alone in this file.** Material UI
 * renders each star as a `<label>` around the icon and a visually hidden
 * "4 Stars", with the real `<input type="radio">` hidden beside it.
 * `userEvent` plays a full pointer sequence, and in jsdom none of it reaches
 * a 1px hidden input under a label — it was tried, with `pointerEventsCheck`
 * off, and the score stayed unset. A plain click on the input is what the
 * component actually listens for. In a browser the label works and a
 * keyboard arrow works; both were checked at 1440 and neither can be checked
 * here, because jsdom has no layout and no hit testing.
 *
 * **The assertion inside is load-bearing.** Without it a selector that
 * stopped matching would leave every caller asserting about a dialog on which
 * no score had been chosen — and four of the tests below say "the button is
 * still disabled", which is true of a dialog nobody has touched. That is D24
 * and D25's shape, one layer down in a helper. It has already earned its
 * keep: the first two versions of this helper silently selected nothing.
 */
function chooseScore(score: number) {
  const label = score === 1 ? '1 Star' : `${score} Stars`;
  fireEvent.click(screen.getByLabelText(label));
  expect(screen.getByText(SCORE_WORDING[score])).toBeInTheDocument();
}

/** The same five sentences `FeedbackDialog` shows, so a reworded one fails here. */
const SCORE_WORDING: Record<number, string> = {
  1: 'Not fixed',
  2: 'Fixed poorly',
  3: 'Fixed',
  4: 'Fixed well',
  5: 'Could not have been better',
};

const sendButton = () => screen.getByRole('button', { name: 'Send feedback' });

describe('leaving a rating', () => {
  it('cannot be sent with no score and no words', () => {
    render();

    expect(sendButton()).toBeDisabled();
  });

  it('cannot be sent with a score but no words', async () => {
    render();

    chooseScore(4);

    expect(sendButton()).toBeDisabled();
  });

  it('cannot be sent with words but no score', async () => {
    render();

    await userEvent.type(screen.getByLabelText(/What happened/), 'It was fine.');

    expect(sendButton()).toBeDisabled();
  });

  it('still needs words at five out of five', async () => {
    // The owner's rule, and the case that would be dropped if anybody ever
    // "simplified" it to asking only on a low score. A five with no words
    // teaches nobody anything, and making praise free while complaining costs
    // a paragraph is how the average stops meaning anything.
    render();

    chooseScore(5);

    expect(sendButton()).toBeDisabled();
  });

  it('refuses whitespace as a comment', async () => {
    // `min_length` alone would let a space through, on the client and on the
    // API — `app/schemas/feedback.py` strips before checking for the same
    // reason.
    render();

    chooseScore(3);
    await userEvent.type(screen.getByLabelText(/What happened/), '    ');

    expect(sendButton()).toBeDisabled();
  });

  it('sends the score and the trimmed comment once both are given', async () => {
    const { onSubmit, onClose } = render();

    chooseScore(2);
    await userEvent.type(screen.getByLabelText(/What happened/), '  Came back the next day.  ');
    await userEvent.click(sendButton());

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ rating: 2, comment: 'Came back the next day.' }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('names the engineer whose work is being rated', () => {
    render();

    expect(screen.getByText(/Sam Senior worked on this ticket/)).toBeInTheDocument();
  });

  it('says who can read it, because that is the thing people ask', () => {
    render();

    expect(screen.getByText(/team leads and facility admins/)).toBeInTheDocument();
  });

  it('manages without an engineer name rather than rendering "undefined"', () => {
    // `engineerName` comes from `incident.assignee`, which is nullable: an
    // admin may unassign a resolved ticket. The rating is still attributed to
    // whoever resolved it, by the API.
    render({ engineerName: undefined });

    expect(screen.getByText(/Only the engineer who worked on this/)).toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });

  it('shows the refusal from the API instead of closing on it', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('nope'));
    const onClose = vi.fn();
    renderWithAuth(
      <FeedbackDialog
        open
        onClose={onClose}
        onSubmit={onSubmit}
        isSubmitting={false}
        engineerName="Sam Senior"
      />,
    );

    chooseScore(1);
    await userEvent.type(screen.getByLabelText(/What happened/), 'Nothing was done.');
    await userEvent.click(sendButton());

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('correcting a rating', () => {
  it('opens on what is stored and says so in its title', () => {
    render({ initial: { rating: 2, comment: 'Took three days.' } });

    expect(screen.getByRole('heading', { name: 'Change your feedback' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Took three days.')).toBeInTheDocument();
    expect(screen.getByText('Fixed poorly')).toBeInTheDocument();
    // Already valid, so it can be sent without touching anything.
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('sends the changed score and comment', async () => {
    const { onSubmit } = render({ initial: { rating: 2, comment: 'Took three days.' } });

    chooseScore(4);
    await userEvent.clear(screen.getByLabelText(/What happened/));
    await userEvent.type(screen.getByLabelText(/What happened/), 'On reflection that was harsh.');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        rating: 4,
        comment: 'On reflection that was harsh.',
      }),
    );
  });
});
