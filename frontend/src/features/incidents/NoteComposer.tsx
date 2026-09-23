import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import { describeError } from '../../api/errors';
import type { NoteVisibility } from '../../api/types';

export interface NoteComposerProps {
  /** Whether the caller may write a staff-only note, from `can_add_internal_note`. */
  canWriteInternal: boolean;
  onSubmit: (payload: { body: string; visibility: NoteVisibility }) => Promise<unknown>;
  isSubmitting: boolean;
}

/**
 * Add a note to a ticket.
 *
 * The internal toggle appears only when `can_add_internal_note` says so, which
 * is the API's answer and not a role check written here. An employee therefore
 * never sees the control at all — and if one somehow posted `INTERNAL`
 * anyway, `services/notes.py` refuses it.
 *
 * The switch is deliberately explicit about what it does rather than saying
 * "Internal". "Staff only — the reporter will not see this" is the sentence
 * someone needs to read *before* writing something they assumed was private.
 */
export function NoteComposer({ canWriteInternal, onSubmit, isSubmitting }: NoteComposerProps) {
  const [body, setBody] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      await onSubmit({ body: body.trim(), visibility: isInternal ? 'INTERNAL' : 'PUBLIC' });
      setBody('');
    } catch (failure) {
      setError(describeError(failure, 'Could not add this note.').message);
    }
  };

  return (
    <Box sx={{ mt: 3 }}>
      <TextField
        label="Add a note"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        multiline
        minRows={3}
        placeholder={
          isInternal
            ? 'Only staff will read this.'
            : 'Everyone on this ticket, including the reporter, will read this.'
        }
      />

      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          mt: 1,
        }}
      >
        {canWriteInternal ? (
          <FormControlLabel
            control={
              <Switch
                checked={isInternal}
                onChange={(event) => setIsInternal(event.target.checked)}
              />
            }
            label={
              <Typography variant="body2">
                Staff only — the reporter will not see this
              </Typography>
            }
          />
        ) : (
          <Typography variant="caption" color="text.secondary">
            Everyone on this ticket can read your notes.
          </Typography>
        )}

        <Button
          variant="contained"
          onClick={() => void submit()}
          loading={isSubmitting}
          disabled={body.trim() === ''}
        >
          Add note
        </Button>
      </Box>

      {error ? (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      ) : null}
    </Box>
  );
}
