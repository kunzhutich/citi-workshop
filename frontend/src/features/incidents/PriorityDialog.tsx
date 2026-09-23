import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import { useState } from 'react';

import { describeError } from '../../api/errors';
import type { IncidentPriority } from '../../api/types';
import { ResponsiveDialog } from '../../components/ResponsiveDialog';
import { INCIDENT_PRIORITIES, priorityHint, priorityLabel } from '../../display/labels';
import { SelectableCard } from './SelectableCard';

export interface PriorityDialogProps {
  open: boolean;
  onClose: () => void;
  currentPriority: IncidentPriority;
  onSubmit: (priority: IncidentPriority) => Promise<unknown>;
  isSubmitting: boolean;
}

/**
 * Change how urgent a ticket is.
 *
 * The same four cards with the same hints the questionnaire used, rather than
 * a dropdown. Someone re-prioritising a ticket is making the same judgement
 * the reporter made, and should be reading the same definitions of "high".
 */
export function PriorityDialog({
  open,
  onClose,
  currentPriority,
  onSubmit,
  isSubmitting,
}: PriorityDialogProps) {
  const [priority, setPriority] = useState<IncidentPriority>(currentPriority);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      await onSubmit(priority);
      onClose();
    } catch (failure) {
      setError(describeError(failure, 'Could not change the priority.').message);
    }
  };

  return (
    <ResponsiveDialog open={open} onClose={onClose} title="Change the priority">
      <DialogContent>
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' },
          }}
        >
          {INCIDENT_PRIORITIES.map((option) => (
            <SelectableCard
              key={option}
              label={priorityLabel(option)}
              hint={priorityHint(option)}
              selected={option === priority}
              onSelect={() => setPriority(option)}
            />
          ))}
        </Box>
        {error ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => void submit()}
          loading={isSubmitting}
          disabled={priority === currentPriority}
        >
          Save
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
