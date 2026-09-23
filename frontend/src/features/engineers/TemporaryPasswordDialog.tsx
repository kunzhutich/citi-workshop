import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import { ResponsiveDialog } from '../../components/ResponsiveDialog';

export interface TemporaryPasswordDialogProps {
  open: boolean;
  onClose: () => void;
  engineerName: string;
  email: string;
  temporaryPassword: string;
}

/**
 * Show the one-time password a new engineer account was created with.
 *
 * It exists in this response and nowhere else — the database holds only its
 * bcrypt hash — so this dialog is the only chance to read it. That is why it
 * says so, why the password is rendered in a monospaced face where `l` and `1`
 * are distinguishable, and why the copy button exists: an admin retyping it
 * into a chat window is how a working account becomes a support ticket.
 *
 * The account is flagged `must_change_password`, so the engineer replaces it
 * at first sign-in and this string stops working.
 */
export function TemporaryPasswordDialog({
  open,
  onClose,
  engineerName,
  email,
  temporaryPassword,
}: TemporaryPasswordDialogProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setCopied(true);
    } catch {
      // Clipboard access can be refused — an insecure origin, a browser
      // policy. The password is on screen either way, so this is not worth an
      // error; the button simply does not confirm.
      setCopied(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onClose={onClose} title={`${engineerName} can now sign in`}>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          This password is shown once. Close this dialog and it is gone.
        </Alert>

        <DialogContentText>Send these to {email}:</DialogContentText>

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mt: 2,
            p: 2,
            borderRadius: 1,
            bgcolor: 'action.hover',
          }}
        >
          <Typography
            sx={{ fontFamily: 'monospace', fontSize: '1.1rem', flexGrow: 1, overflowWrap: 'anywhere' }}
          >
            {temporaryPassword}
          </Typography>
          <IconButton onClick={() => void copy()} aria-label="Copy password">
            <ContentCopyIcon />
          </IconButton>
        </Box>

        {copied ? (
          <Typography variant="caption" color="success.main">
            Copied.
          </Typography>
        ) : null}

        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          They will be asked to choose their own password the first time they sign in.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
