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
    // Roboto and Inter are both self-hosted in `fonts.ts`. Roboto is first, so
    // it is the one browsers fetch and render — and it is the family Material
    // UI's own component heights were calibrated against, which is the reason
    // to lead with it. Inter is fetched only if Roboto's files cannot be.
    // Arial then precedes Helvetica deliberately: Arial resolves to metrics
    // that centre almost evenly, while Helvetica resolves to Nimbus Sans on
    // Linux, which leans 0.26em — the fault self-hosting fixes.
    fontFamily: ['Roboto', 'Inter', 'Arial', 'Helvetica', 'sans-serif'].join(','),
    h1: { fontSize: '1.9rem', fontWeight: 600 },
    h2: { fontSize: '1.35rem', fontWeight: 600 },
    h3: { fontSize: '1.1rem', fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiCssBaseline: {
      styleOverrides: (current) => ({
        /*
         * One visible focus ring for the whole application.
         *
         * There was none before this: focus was whatever Material UI's ripple
         * happened to leave behind, which on an outlined card that already has
         * a coloured border is close to nothing. A keyboard user has to be
         * able to see where they are at every step, on every control, which is
         * a thing only a global rule can promise.
         *
         * `:focus-visible` rather than `:focus`, so a mouse click does not
         * leave a ring behind — the reason authors used to delete focus styles
         * altogether, and the problem this pseudo-class exists to solve.
         */
        ':focus-visible': {
          outline: `3px solid ${current.palette.primary.main}`,
          outlineOffset: 2,
        },
        /*
         * The app bar is filled with that same primary colour, so a primary
         * ring on it would be invisible. White is the only thing guaranteed to
         * contrast with the surface its controls sit on.
         */
        '.MuiAppBar-root :focus-visible': {
          outline: `3px solid ${current.palette.common.white}`,
          outlineOffset: 2,
        },
        /*
         * Honour the operating system's reduced-motion setting. Everything
         * here animates for polish rather than meaning, so there is nothing to
         * lose by turning it off for someone who asked.
         */
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': {
            animationDuration: '0.01ms !important',
            animationIterationCount: '1 !important',
            transitionDuration: '0.01ms !important',
            scrollBehavior: 'auto !important',
          },
        },
      }),
    },
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
