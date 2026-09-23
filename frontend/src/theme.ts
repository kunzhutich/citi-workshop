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

    /*
     * The status palette, pinned and contrast-checked.
     *
     * These four were Material UI's defaults until S6, when an axe run over
     * the ticket list found the OPEN chip failing: white on `#0288d1` is
     * 3.86:1, and a 13px chip label needs 4.5:1. `warning` was worse at 3.11.
     * `chartPalette.ts` had been validated since M7; this half of the palette
     * never had been, because it was never written down — it was whatever the
     * library shipped.
     *
     * One number decides both variants. A filled chip is white text on the
     * colour and an outlined chip is the colour on white, so both are the
     * colour's contrast against white, and one check covers both.
     *
     * **Checked against two backgrounds, not one.** The first attempt at this
     * used `#0277bd`, which is 4.80 against white and passes — and 4.43
     * against `background.default` (#f4f6fa), which does not. An outlined chip
     * sits on the page as often as on a card, so both surfaces have to clear
     * the bar. That second number is what axe caught, on the ticket detail
     * page, after the first fix.
     *
     *              vs #ffffff   vs #f4f6fa
     *   info     #026da8   5.59       5.17   (was #0288d1: 3.86 / 3.56)
     *   warning  #b45309   5.02       4.64   (was #ed6c02: 3.11 / 2.87)
     *   success  #2e7d32   5.13       4.75   (unchanged; already passed)
     *   error    #d32f2f   4.98       4.61   (unchanged; already passed)
     *
     * The two that passed are pinned anyway, so that a library upgrade cannot
     * quietly move them and so this comment can say what was measured rather
     * than what was changed.
     */
    info: { main: '#026da8' },
    warning: { main: '#b45309' },
    success: { main: '#2e7d32' },
    error: { main: '#d32f2f' },
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
        /*
         * `body :focus-visible`, not `:focus-visible`.
         *
         * Material UI's `ButtonBase` sets `outline: 0` in its own root class.
         * A bare `:focus-visible` has the same specificity as that class
         * (0,1,0), so which one wins comes down to stylesheet order — and
         * Emotion injects the component's styles after `CssBaseline`'s, so
         * Material UI won. The ring was present in the theme, absent on every
         * button, card and navigation link in the application, and a passing
         * axe run said nothing about it: axe does not check that focus is
         * visible, only that things have names.
         *
         * It was found by tabbing to a category card and looking at the
         * screenshot. Adding `body` costs one element to the selector and
         * takes the specificity to (0,1,1), which beats the class.
         */
        'body :focus-visible': {
          outline: `3px solid ${current.palette.primary.main}`,
          outlineOffset: 2,
        },
        /*
         * The app bar is filled with that same primary colour, so a primary
         * ring on it would be invisible. White is the only thing guaranteed to
         * contrast with the surface its controls sit on.
         */
        'body .MuiAppBar-root :focus-visible': {
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
    MuiFormHelperText: {
      styleOverrides: {
        root: ({ theme: current }) => ({
          /*
           * Helper text stays readable while its field is disabled.
           *
           * Material UI greys it to `text.disabled`, which is 2.64:1 against
           * the page — and on the report questionnaire the disabled field's
           * helper text is "Choose a building first". The sentence telling you
           * how to enable the control is the one you need most while the
           * control is disabled, and it was the least readable text on the
           * form. `text.secondary` is 5.63:1.
           *
           * Scoped to helper text deliberately. A disabled *control* should
           * still look disabled — WCAG exempts it, and making one look
           * available when it is not is a worse problem than a faint label.
           * This is instruction text that merely happens to live inside one.
           */
          '&.Mui-disabled': { color: current.palette.text.secondary },
        }),
      },
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
