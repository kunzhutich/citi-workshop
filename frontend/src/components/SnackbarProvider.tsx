import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { useBreakpoint } from '../hooks/useBreakpoint';
import { SnackbarContext, type SnackbarSeverity } from './SnackbarContext';

/** How long a message stays on screen, in milliseconds. */
const AUTO_HIDE_MS = 5000;

interface SnackbarMessage {
  text: string;
  severity: SnackbarSeverity;
  /** Distinguishes two identical messages, so the second one re-opens. */
  key: number;
}

/**
 * Supplies `useSnackbar` and renders the one snackbar the app has.
 *
 * One at a time, deliberately. A queue would let three stacked toasts hide the
 * button that produced them, and the messages here are confirmations —
 * "INC-000482 created" — rather than anything a user must read in order.
 * Failures that need reading land on the form or the page that caused them.
 */
export function SnackbarProvider({ children }: { children: ReactNode }) {
  const { isMobile } = useBreakpoint();
  const [message, setMessage] = useState<SnackbarMessage | null>(null);

  const notify = useCallback((text: string, severity: SnackbarSeverity = 'success') => {
    setMessage({ text, severity, key: Date.now() });
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <SnackbarContext value={value}>
      {children}
      <Snackbar
        key={message?.key}
        open={message !== null}
        autoHideDuration={AUTO_HIDE_MS}
        onClose={() => setMessage(null)}
        // Bottom on desktop, which is the convention, and **top on a phone**,
        // which is not. The bottom of a phone screen is where this app puts
        // its controls: the shell's navigation bar, the report FAB, and the
        // incident detail page's sticky action bar. A confirmation that
        // covers the buttons it is confirming is worse than no confirmation,
        // and it did exactly that — "You have picked this ticket up" landed
        // on top of "Start work".
        anchorOrigin={
          isMobile
            ? { vertical: 'top', horizontal: 'center' }
            : { vertical: 'bottom', horizontal: 'center' }
        }
        // Below the fixed app bar rather than over it.
        sx={isMobile ? { top: 72 } : undefined}
      >
        <Alert
          onClose={() => setMessage(null)}
          severity={message?.severity ?? 'info'}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {message?.text}
        </Alert>
      </Snackbar>
    </SnackbarContext>
  );
}
