import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import FormLabel from '@mui/material/FormLabel';
import Rating from '@mui/material/Rating';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import type { FeedbackPayload } from '../../api/feedback';
import { describeError } from '../../api/errors';
import { ResponsiveDialog } from '../../components/ResponsiveDialog';

/**
 * What each score means, in words.
 *
 * A `Record` over the five values rather than an array indexed by the score,
 * so a scale that changed would be a compile error rather than an
 * `undefined` under somebody's stars. The wording is about the *work*, not
 * about how the reader feels — "Not fixed" is a fact the engineer can act on
 * and "Terrible" is not.
 */
const SCORE_WORDING: Record<number, string> = {
  1: 'Not fixed',
  2: 'Fixed poorly',
  3: 'Fixed',
  4: 'Fixed well',
  5: 'Could not have been better',
};

export interface FeedbackDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: FeedbackPayload) => Promise<unknown>;
  isSubmitting: boolean;
  /** Who did the work, so the dialog can say whose it is being rated. */
  engineerName?: string;
  /** Set when correcting an existing rating rather than leaving a new one. */
  initial?: FeedbackPayload;
}

/**
 * Ask the reporter what they thought of the repair.
 *
 * **The comment is required at every score**, which is the owner's rule and
 * the one thing about this dialog worth defending. Asking for words only on a
 * low score makes the feature an incident report rather than a measurement:
 * the fives arrive contentless, nobody learns what good looked like, and the
 * person typing knows that saying something nice costs them nothing while
 * complaining costs them a paragraph.
 *
 * The API enforces it too — `app/schemas/feedback.py` sets a minimum length,
 * and the column is NOT NULL. This is the fast half of the same rule.
 */
export function FeedbackDialog({
  open,
  onClose,
  onSubmit,
  isSubmitting,
  engineerName,
  initial,
}: FeedbackDialogProps) {
  // Initialised from `initial` and never synchronised back to it, because it
  // never changes underneath: `IncidentDetailPage` mounts this component only
  // while its dialog is the open one, so every open is a fresh mount with
  // fresh state. A cancelled draft cannot come back, and a correction always
  // opens on what is stored — without an effect that would re-run mid-typing.
  const [rating, setRating] = useState<number | null>(initial?.rating ?? null);
  const [comment, setComment] = useState(initial?.comment ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (rating === null) {
      return;
    }
    setError(null);
    try {
      await onSubmit({ rating, comment: comment.trim() });
      onClose();
    } catch (failure) {
      setError(describeError(failure, 'Could not save your feedback.').message);
    }
  };

  const title = initial ? 'Change your feedback' : 'How did this go?';

  return (
    <ResponsiveDialog open={open} onClose={onClose} title={title}>
      <DialogContent>
        <DialogContentText>
          {engineerName
            ? `${engineerName} worked on this ticket. Only they, team leads and facility admins can read what you write.`
            : 'Only the engineer who worked on this, team leads and facility admins can read what you write.'}
        </DialogContentText>

        <FormLabel
          id="feedback-rating-label"
          required
          sx={{ display: 'block', mt: 3, mb: 0.5, typography: 'subtitle2' }}
        >
          How well was it fixed?
        </FormLabel>
        <Rating
          name="feedback-rating"
          value={rating}
          onChange={(_event, value) => setRating(value)}
          size="large"
          aria-labelledby="feedback-rating-label"
        />
        {/*
          The chosen score in words, beside the stars rather than instead of
          them. Five glyphs are not a value a screen reader can read out, and
          MUI's own label is a bare "4 Stars"; this says what 4 means here.

          The height is held whether or not a score is chosen, so picking one
          does not shift the comment field down under the pointer.
        */}
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ minHeight: (theme) => theme.spacing(3) }}
        >
          {rating === null ? ' ' : SCORE_WORDING[rating]}
        </Typography>

        <TextField
          required
          label="What happened?"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          multiline
          minRows={3}
          margin="normal"
          helperText="Needed whatever the score — a five with no words teaches nobody anything."
        />
        {error ? <Alert severity="error">{error}</Alert> : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => void submit()}
          loading={isSubmitting}
          disabled={rating === null || comment.trim().length === 0}
        >
          {initial ? 'Save changes' : 'Send feedback'}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
