import { createTheme } from '@mui/material/styles';

/*
 * `workflow` is a palette slot of our own, beside Material UI's five.
 *
 * The brand is brown and a ticket's progress is blue, and those are two
 * different jobs that used to be one colour. Declaring the slot is what lets
 * `<Chip color="workflow">` type-check; without the second declaration
 * Material UI's `ChipProps['color']` is a closed union and the status palette
 * would have to go back to hardcoded hexes at the point of use.
 */
declare module '@mui/material/styles' {
  interface Palette {
    workflow: Palette['primary'];
  }
  interface PaletteOptions {
    workflow?: PaletteOptions['primary'];
  }
}

declare module '@mui/material/Chip' {
  interface ChipPropsColorOverrides {
    workflow: true;
  }
}

declare module '@mui/material/LinearProgress' {
  interface LinearProgressPropsColorOverrides {
    workflow: true;
  }
}

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
/**
 * A throwaway default theme, used only for `augmentColor`.
 *
 * Material UI fills in `light`, `dark` and `contrastText` for the five palette
 * slots it knows about, and for nothing else. A custom slot declared as
 * `{ main }` alone therefore has no `contrastText`, and a filled `Chip` using
 * it renders grey — which is exactly what happened, and what a screenshot
 * caught and the type-checker could not.
 */
const augment = createTheme().palette.augmentColor;

export const theme = createTheme({
  palette: {
    mode: 'light',

    /*
     * The palette the redesign brief asks for: a cream page, a brown primary,
     * and a third colour to sit between them.
     *
     * `background.paper` stays pure white deliberately. The brief changes the
     * *page* background; cards sitting a shade lighter than the page is what
     * makes them read as cards, and it has a second benefit worth stating —
     * `features/dashboard/chartPalette.ts` is validated against the surface
     * its marks are painted on, which is `background.paper`. Holding that one
     * colour still means the chart palette's numbers move only because we
     * chose to change the hues, never because the surface moved underneath
     * them. A warm off-white here would be a defensible taste call and would
     * invalidate every figure in that file.
     */
    primary: { main: '#73362a' },

    /*
     * The third colour: a warm ochre, in two steps rather than one.
     *
     * The brief suggests `#a9743a` and asks for a mid-tone usable for
     * secondary surfaces, hover states and chart series. One token cannot be
     * all three, because `secondary.main` in this application is always a
     * *surface with white text on it* — the account avatar's initials
     * (`layout/UserMenu.tsx`, `layout/DrawerAccountSection.tsx`) and the note
     * dot on the activity timeline. White on `#a9743a` is 4.00:1, which fails
     * AA for the 15px initials.
     *
     * So `main` is the ochre hue snapped down until white text on it clears
     * the bar (5.56:1), and `light` keeps the brief's literal value for the
     * places nothing sits on top: hover washes and tints.
     *
     * Ochre rather than the two alternatives the brief offers, and the reason
     * is measurable rather than a matter of taste. The third colour has two
     * jobs — an accent beside the brown, and the hue the charts are drawn from
     * — and only one candidate does both with the same colour.
     *
     *            OKLCH hue   from primary   chroma as given   as a chart step
     *   ochre       66.3°        33.7°          0.100           #b46d00
     *   clay        40.4°         7.9°          0.097           #d74c00
     *   olive      114.8°        82.3°          0.065           #7f8900
     *
     * A chart mark needs chroma of at least 0.10 or it reads as grey at bar
     * size. Ochre is already there, so its chart step is the same colour one
     * shade stronger. Clay has to travel to a vivid orange-red that is no
     * longer a brown and collides with the error chip — and as an accent it is
     * eight degrees from the primary, close enough to read as the app bar
     * slightly faded. Olive gives the most separation of the three and is the
     * furthest from its own chart step: a muted sage in the interface and a
     * chartreuse in the charts, which is two colours wearing one name.
     *
     * See D48 for the full derivation and what a different choice would cost.
     */
    secondary: { main: '#8b5f30', light: '#a9743a' },

    /*
     * The colour a ticket's *progress* is drawn in, which is not the brand.
     *
     * This is the old primary navy, kept. The brand went brown in the redesign
     * and the workflow did not follow it, on the owner's call and for a reason
     * worth writing down: brown is a brand, blue is a convention. A reader who
     * has never seen this application still reads a blue step as "this is
     * where it has got to"; nobody reads brown that way.
     *
     * It paints the IN_PROGRESS chip (`display/statusColor.ts`) and the
     * ticket's stepper (`features/incidents/WorkflowStepper.tsx`), and nothing
     * else. The app bar, the drawer's call to action and the workflow buttons
     * stay `primary`, because those are the product speaking rather than the
     * ticket.
     *
     * Separating the two also undid the one thing the new palette made worse.
     * While IN_PROGRESS borrowed `primary`, it sat at OKLab ΔE 13.4 from the
     * BLOCKED chip — two browns, under the 15 floor, on the pair an engineer
     * scans a list for. Against the navy that distance is 30.9. See D49 and
     * D51.
     *
     * 10.07:1 with white text, 8.39:1 outlined on the cream page.
     */
    workflow: augment({ color: { main: '#1f3a93' }, name: 'workflow' }),

    background: { default: '#f0eada', paper: '#ffffff' },

    /*
     * The status palette, re-derived for the cream page.
     *
     * S6 pinned these four against white *and* against the page, because an
     * outlined chip sits on both — `PriorityChip` is outlined, and it is on
     * every row of every list. The page was `#f4f6fa` then and is `#f0eada`
     * now, which is darker: relative luminance 0.824 against 0.920. Three of
     * the four quietly stopped passing.
     *
     *              vs #ffffff   vs #f0eada
     *   info     #026da8   5.59       4.66   (unchanged — already cleared)
     *   warning  #a94e08   5.56       4.63   (was #b45309: 5.02 / 4.18 FAIL)
     *   success  #2c7730   5.54       4.62   (was #2e7d32: 5.13 / 4.27 FAIL)
     *   error    #c72a2a   5.54       4.61   (was #d32f2f: 4.98 / 4.15 FAIL)
     *
     * The three were **re-derived, not re-picked**: each was walked down its
     * own hue at constant saturation until it cleared 4.6 against the new
     * page, which is 4.5 plus enough headroom that a rounding cannot decide
     * it. Hue drift is 0.2° at worst, so these are the same four colours at a
     * darker step rather than four new ones. Clearing the cream page clears
     * white automatically, the cream being the harder of the two.
     *
     * Filled chips are white text on the colour and outlined chips are the
     * colour on a surface, so one number still covers both variants — which is
     * why the table has two columns and not four.
     */
    info: { main: '#026da8' },
    warning: { main: '#a94e08' },
    success: { main: '#2c7730' },
    error: { main: '#c72a2a' },
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
         * ...except on a composed input, where the focusable element is the
         * bare `<input>` inside the field rather than the field itself.
         *
         * The rule above drew its ring around that inner `<input>`, which
         * stops short of the search icon and knows nothing about the rounded
         * outline the field is wearing — so clicking the app bar's search box
         * produced a hard white rectangle sitting inside a rounded one. A text
         * input matches `:focus-visible` on a mouse click too, so this was
         * every use of the control, not an edge case for keyboard users.
         *
         * The ring moves out to `.MuiInputBase-root`, which is the whole
         * field: it picks up the theme's border radius, encloses the icon, and
         * is the shape a reader would draw if asked to point at "the search
         * box". Focus is still shown, and shown once — which is the part S6
         * cared about.
         */
        'body .MuiAppBar-root .MuiInputBase-input:focus-visible': {
          outline: 'none',
        },
        'body .MuiAppBar-root .MuiInputBase-root:has(:focus-visible)': {
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
    MuiToggleButton: {
      styleOverrides: {
        root: ({ theme: current }) => ({
          /*
           * An unselected toggle wears a text token, not `action.active`.
           *
           * Material UI colours it `rgba(0, 0, 0, 0.54)`, which resolves to
           * `#6e6c64` on the cream page — 4.38:1, and the label is 13px, so it
           * needs 4.5. It passed on the old near-white page at 4.61 and failed
           * the moment the background warmed up.
           *
           * Found by the axe run over the notification inbox, **not** by
           * `theme.test.ts`: that asserts the slots this application chooses,
           * and this colour is a library default we never named. The two
           * checks cover different ground and both are needed.
           *
           * `text.secondary` is the token the label should have had anyway —
           * it is text — and it is 5.40:1 on the page and 5.74:1 on a card.
           * The selected state is untouched; Material UI gives it
           * `primary.main` on a tint, which the palette already checks.
           */
          '&:not(.Mui-selected)': { color: current.palette.text.secondary },
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
