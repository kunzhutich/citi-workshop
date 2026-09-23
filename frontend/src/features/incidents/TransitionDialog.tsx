import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { useState } from 'react';

import { describeError } from '../../api/errors';
import type { TransitionPayload } from '../../api/incidents';
import { listIncidents } from '../../api/incidents';
import type { AllowedTransition, BlockedReasonType, CloseReason } from '../../api/types';
import { ResponsiveDialog } from '../../components/ResponsiveDialog';
import { BLOCKED_REASON_TYPES, blockedReasonLabel, closeReasonLabel } from '../../display/labels';

/**
 * Collects exactly what a workflow move needs, and nothing else.
 *
 * The dialog is built from `transition.required_fields` — the list the API
 * returned for this ticket, this user and this moment. There is no table here
 * mapping "Resolve" to "resolution summary"; that mapping is a row of
 * `app/workflow.py`, and adding a field to a transition changes this dialog
 * without anyone editing it.
 *
 * The one input not named in `required_fields` is the duplicate ticket. It is
 * conditionally required — only when `close_reason` is DUPLICATE — which is a
 * rule `_resolve_duplicate_target` enforces and a flat list of field names
 * cannot express. The dialog reveals it on that choice and the API refuses
 * without it either way.
 */

export interface TransitionDialogProps {
  open: boolean;
  onClose: () => void;
  transition: AllowedTransition;
  onSubmit: (payload: TransitionPayload) => Promise<unknown>;
  isSubmitting: boolean;
}

export function TransitionDialog({
  open,
  onClose,
  transition,
  onSubmit,
  isSubmitting,
}: TransitionDialogProps) {
  const [reason, setReason] = useState('');
  const [blockedReasonType, setBlockedReasonType] = useState<BlockedReasonType | ''>('');
  const [blockedReason, setBlockedReason] = useState('');
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [closeReason, setCloseReason] = useState<CloseReason | ''>('');
  const [duplicateReference, setDuplicateReference] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const requires = (field: string) => transition.required_fields.includes(field);
  const needsDuplicate = requires('close_reason') && closeReason === 'DUPLICATE';

  const submit = async () => {
    setFormError(null);
    setFieldErrors({});

    const payload: TransitionPayload = { to_status: transition.to_status };
    if (requires('reason')) {
      payload.reason = reason.trim();
    }
    if (requires('blocked_reason_type') && blockedReasonType) {
      payload.blocked_reason_type = blockedReasonType;
    }
    if (requires('blocked_reason')) {
      payload.blocked_reason = blockedReason.trim();
    }
    if (requires('resolution_summary')) {
      payload.resolution_summary = resolutionSummary.trim();
    }
    if (requires('close_reason') && closeReason) {
      payload.close_reason = closeReason;
    }

    // Resolved before the transition is attempted, and reported on its own
    // input. `describeError` only understands the API's error bodies, so a
    // local failure here would otherwise surface as the generic fallback.
    if (needsDuplicate) {
      const resolved = await resolveDuplicateId(duplicateReference);
      if (!resolved.id) {
        setFieldErrors({ duplicate_of_id: resolved.problem });
        return;
      }
      payload.duplicate_of_id = resolved.id;
    }

    try {
      await onSubmit(payload);
      onClose();
    } catch (error) {
      const described = describeError(error, `Could not ${transition.action_label.toLowerCase()}.`);
      setFieldErrors(described.fieldErrors);
      setFormError(described.message);
    }
  };

  return (
    <ResponsiveDialog open={open} onClose={onClose} title={transition.action_label}>
      <DialogContent>
        {transition.required_fields.length === 0 && !needsDuplicate ? (
          <DialogContentText>
            This moves the ticket to {transition.to_status.toLowerCase().replace('_', ' ')}. It
            needs nothing else from you.
          </DialogContentText>
        ) : null}

        {requires('blocked_reason_type') ? (
          <TextField
            select
            required
            label="What is it waiting on?"
            value={blockedReasonType}
            onChange={(event) => setBlockedReasonType(event.target.value as BlockedReasonType)}
            error={Boolean(fieldErrors.blocked_reason_type)}
            helperText={fieldErrors.blocked_reason_type}
            margin="normal"
          >
            {BLOCKED_REASON_TYPES.map((option) => (
              <MenuItem key={option} value={option}>
                {blockedReasonLabel(option)}
              </MenuItem>
            ))}
          </TextField>
        ) : null}

        {requires('blocked_reason') ? (
          <TextField
            required
            label="Details"
            value={blockedReason}
            onChange={(event) => setBlockedReason(event.target.value)}
            error={Boolean(fieldErrors.blocked_reason)}
            helperText={
              fieldErrors.blocked_reason ?? 'What exactly is needed, and from whom.'
            }
            multiline
            minRows={3}
            margin="normal"
          />
        ) : null}

        {requires('resolution_summary') ? (
          <TextField
            required
            label="What did you do?"
            value={resolutionSummary}
            onChange={(event) => setResolutionSummary(event.target.value)}
            error={Boolean(fieldErrors.resolution_summary)}
            helperText={
              fieldErrors.resolution_summary ??
              'The reporter reads this, so say it the way you would to them.'
            }
            multiline
            minRows={3}
            margin="normal"
          />
        ) : null}

        {requires('close_reason') ? (
          <TextField
            select
            required
            label="Why is it being closed?"
            value={closeReason}
            onChange={(event) => setCloseReason(event.target.value as CloseReason)}
            error={Boolean(fieldErrors.close_reason)}
            helperText={fieldErrors.close_reason}
            margin="normal"
          >
            {transition.close_reason_choices.map((option) => (
              <MenuItem key={option} value={option}>
                {closeReasonLabel(option)}
              </MenuItem>
            ))}
          </TextField>
        ) : null}

        {needsDuplicate ? (
          <TextField
            required
            label="Duplicate of"
            placeholder="INC-000123"
            value={duplicateReference}
            onChange={(event) => setDuplicateReference(event.target.value)}
            error={Boolean(fieldErrors.duplicate_of_id)}
            helperText={
              fieldErrors.duplicate_of_id ?? 'The ticket number this one repeats.'
            }
            margin="normal"
          />
        ) : null}

        {requires('reason') ? (
          <TextField
            required
            label="Why?"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={Boolean(fieldErrors.reason)}
            helperText={fieldErrors.reason ?? 'Recorded on the ticket, and everyone can read it.'}
            multiline
            minRows={3}
            margin="normal"
          />
        ) : null}

        {formError ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {formError}
          </Alert>
        ) : null}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => void submit()} loading={isSubmitting}>
          {transition.action_label}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}

/**
 * Turn a typed ticket number into the id the API wants.
 *
 * `POST /transitions` takes `duplicate_of_id`, a UUID, but nobody knows a
 * ticket by its UUID — they know it as INC-000123, which is what the ticket
 * numbers on every other screen say. The list endpoint already resolves that
 * form, so one search turns what an admin can type into what the API accepts.
 *
 * Returns the problem as a value rather than throwing it, so the caller can
 * attach it to the input that caused it.
 */
async function resolveDuplicateId(
  reference: string,
): Promise<{ id: string | null; problem: string }> {
  const trimmed = reference.trim();
  if (!trimmed) {
    return { id: null, problem: 'Say which ticket this one duplicates.' };
  }

  try {
    const found = await listIncidents({ q: trimmed, page_size: 2 });
    const exact = found.items.find(
      (candidate) => candidate.reference.toLowerCase() === trimmed.toLowerCase(),
    );
    const match = exact ?? found.items[0];

    if (!match) {
      return { id: null, problem: `No ticket matches "${trimmed}".` };
    }
    return { id: match.id, problem: '' };
  } catch {
    return { id: null, problem: 'Could not look that ticket up. Check the number and try again.' };
  }
}
