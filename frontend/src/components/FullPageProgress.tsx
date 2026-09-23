import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';

/**
 * The whole-page waiting state, used while the session is being restored.
 *
 * Deliberately quiet — on a warm session this is on screen for a few hundred
 * milliseconds, and a large spinner reads as a fault rather than a pause.
 */
export function FullPageProgress({ label = 'Loading…' }: { label?: string }) {
  return (
    <Box
      // A live region, so the wait is announced rather than silent. This is
      // the screen shown while the session is restored on every cold load,
      // and until S6 it was the first thing a screen-reader user met: a page
      // with no focusable element, no landmark and nothing to announce.
      role="status"
      aria-live="polite"
      aria-busy
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
      }}
    >
      {/* Hidden from the tree: the sentence below already says what it means,
          and a labelled spinner beside labelled text is read twice. */}
      <CircularProgress size={28} aria-hidden />
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}
