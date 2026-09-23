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
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
      }}
    >
      <CircularProgress size={28} />
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}
