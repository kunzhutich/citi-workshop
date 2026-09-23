import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { useState } from 'react';

import { describeError } from '../../api/errors';
import type { IncidentPriority } from '../../api/types';
import { ResponsiveDialog } from '../../components/ResponsiveDialog';
import { INCIDENT_PRIORITIES, priorityLabel } from '../../display/labels';

/** Shortest note the API accepts, from `TransitionReason`. */
const MIN_NOTE_LENGTH = 3;

export interface ClearEscalationDialogProps {
  open: boolean;
  onClose: () => void;
  currentPriority: IncidentPriority;
  escalationReason: string | null;
  onSubmit: (payload: { note: string; priority?: IncidentPriority }) => Promise<unknown>;
  isSubmitting: boolean;
}

/**
 * Resolve an escalation, with the option to re-prioritise in the same breath.
 *
 * Those two are usually one decision: an admin who accepts the escalation
 * raises the priority *and* clears the flag, and an admin who rejects it
 * clears the flag alone. The API takes them together for that reason, so the
 * dialog does too — two separate actions would let a ticket sit re-prioritised
 * and still flagged because someone was interrupted between them.
 */
export function ClearEscalationDialog({
  open,
  onClose,
  currentPriority,
  escalationReason,
  onSubmit,
  isSubmitting,
}: ClearEscalationDialogProps) {
  const [note, setNote] = useState('');
  const [priority, setPriority] = useState<IncidentPriority | ''>('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      await onSubmit({ note: note.trim(), priority: priority || undefined });
      setNote('');
      setPriority('');
      onClose();
    } catch (failure) {
      setError(describeError(failure, 'Could not clear this escalation.').message);
    }
  };

  return (
    <ResponsiveDialog open={open} onClose={onClose} title="Clear the escalation">
      <DialogContent>
        {escalationReason ? (
          <DialogContentText>The reporter said: “{escalationReason}”</DialogContentText>
        ) : null}
        <TextField
          required
          autoFocus
          label="What was done about it?"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          helperText="Recorded on the ticket's history."
          multiline
          minRows={3}
          margin="normal"
        />
        <TextField
          select
          label="Change the priority at the same time"
          value={priority}
          onChange={(event) => setPriority(event.target.value as IncidentPriority)}
          helperText={`Currently ${priorityLabel(currentPriority)}. Leave blank to keep it.`}
          margin="normal"
        >
          <MenuItem value="">Keep it as it is</MenuItem>
          {INCIDENT_PRIORITIES.map((option) => (
            <MenuItem key={option} value={option}>
              {priorityLabel(option)}
            </MenuItem>
          ))}
        </TextField>
        {error ? <Alert severity="error">{error}</Alert> : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => void submit()}
          loading={isSubmitting}
          disabled={note.trim().length < MIN_NOTE_LENGTH}
        >
          Clear escalation
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
