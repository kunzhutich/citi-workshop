import { createTheme } from '@mui/material/styles';

/**
 * Application theme.
 *
 * Kept deliberately small for now: colours and typography that later phases
 * build on (status and priority chips, the workflow stepper) rather than a full
 * design system up front.
 */
export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1f3a93' },
    secondary: { main: '#6d28d9' },
    background: { default: '#f4f6fa' },
  },
  typography: {
    fontFamily: ['Inter', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'].join(','),
    h1: { fontSize: '1.9rem', fontWeight: 600 },
    h2: { fontSize: '1.35rem', fontWeight: 600 },
  },
  shape: { borderRadius: 10 },
});
