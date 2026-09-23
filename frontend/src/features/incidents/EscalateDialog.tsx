import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import TextField from '@mui/material/TextField';
import { useState } from 'react';

import { describeError } from '../../api/errors';
import { ResponsiveDialog } from '../../components/ResponsiveDialog';

/** Shortest escalation reason the API accepts, from `EscalationReason`. */
const MIN_REASON_LENGTH = 5;

export interface EscalateDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<unknown>;
  isSubmitting: boolean;
}

/**
 * Ask a reporter why their ticket needs more attention than it is getting.
 *
 * Escalation is the one lever a reporter has that is not a status change, so
 * it deliberately costs a sentence: a flag with no reason tells an admin that
 * someone is unhappy and nothing about what to do.
 */
export function EscalateDialog({ open, onClose, onSubmit, isSubmitting }: EscalateDialogProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      await onSubmit(reason.trim());
      setReason('');
      onClose();
    } catch (failure) {
      setError(describeError(failure, 'Could not escalate this ticket.').message);
    }
  };

  return (
    <ResponsiveDialog open={open} onClose={onClose} title="Escalate this ticket">
      <DialogContent>
        <DialogContentText>
          A facility admin will see this on their dashboard. Say what has changed or why the
          current priority is wrong.
        </DialogContentText>
        <TextField
          required
          autoFocus
          label="Why does this need attention?"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          multiline
          minRows={3}
          margin="normal"
        />
        {error ? <Alert severity="error">{error}</Alert> : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color="error"
          onClick={() => void submit()}
          loading={isSubmitting}
          disabled={reason.trim().length < MIN_REASON_LENGTH}
        >
          Escalate
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
