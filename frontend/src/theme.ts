import { createTheme } from '@mui/material/styles';

/**
 * The single source of global styling.
 *
 * There are no `.css` files in this project: one-off layout goes in `sx`,
 * anything reused becomes a `styled()` component, and everything global lives
 * here — palette, typography, shape and component defaults. `CssBaseline` in
 * `main.tsx` is the only reset.
 *
 * Component defaults carry their weight: setting `textTransform: 'none'` once
 * is what stops forty buttons from each needing an `sx` prop to look right.
 */
export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1f3a93' },
    secondary: { main: '#6d28d9' },
    background: { default: '#f4f6fa', paper: '#ffffff' },
  },
  typography: {
    // Inter is self-hosted in `fonts.ts`, so it is what actually renders; the
    // rest is the degraded case if that request fails. Arial precedes
    // Helvetica deliberately: Arial resolves to metrics that centre almost
    // evenly (0.02em of lean), while Helvetica resolves to Nimbus Sans on
    // Linux, which leans 0.26em — the very fault self-hosting fixes.
    fontFamily: ['Inter', 'Roboto', 'Arial', 'Helvetica', 'sans-serif'].join(','),
    h1: { fontSize: '1.9rem', fontWeight: 600 },
    h2: { fontSize: '1.35rem', fontWeight: 600 },
    h3: { fontSize: '1.1rem', fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
    },
    MuiTextField: {
      // Every form in the app uses the same field shape; screens opt out
      // explicitly rather than each one opting in.
      defaultProps: { fullWidth: true, size: 'medium' },
    },
    MuiCard: {
      defaultProps: { variant: 'outlined' },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: ({ theme: current }) => ({
          backgroundColor: current.palette.background.paper,
          borderRight: `1px solid ${current.palette.divider}`,
        }),
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: ({ theme: current }) => ({
          '&.Mui-selected': {
            backgroundColor: current.palette.action.selected,
            fontWeight: 600,
          },
        }),
      },
    },
  },
});
