import type { IncidentPriority } from '../../api/types';

/**
 * The colours the dashboard's charts are drawn in, and the rules behind them.
 *
 * These are **not** the chip colours from `theme.ts`. A chip is a small token
 * beside its own label; a chart mark is a block of colour that a reader may
 * have to tell apart from the block next to it, sometimes with a red-green
 * deficiency, sometimes in print. The two jobs have different constraints, so
 * they get different palettes, and this module is the one place the chart
 * palette is written down.
 *
 * Every value here was checked with the data-visualisation validator against
 * this application's own chart surface — `background.paper`, `#ffffff` —
 * rather than against the tool's default surface, because a contrast figure is
 * only meaningful against the background the mark is actually painted on.
 *
 * Three jobs, three treatments:
 *
 * 1. **One series, many categories** (status, category group, building). One
 *    colour for every bar: {@link SERIES_PRIMARY}. Colouring those bars by
 *    their own value would encode the bar's length twice and spend the only
 *    free channel on information the length already carries.
 * 2. **An ordered scale** (priority). A single-hue ramp, light to dark, so
 *    "more urgent" reads as "darker": {@link PRIORITY_RAMP}. This is the one
 *    case where a ramp is right, because the categories genuinely have an
 *    order.
 * 3. **Two series that must be told apart** (created versus closed per day).
 *    Two categorical hues, blue and orange, with a legend:
 *    {@link SERIES_PRIMARY} and {@link SERIES_SECONDARY}.
 *
 * Validator results, all against `#ffffff`:
 *
 * * `#b46d00,#007ca5` as a categorical pair — every check passes; worst CVD
 *   ΔE 18.9 under protanopia, normal-vision ΔE 24.6, both well above the 8 and
 *   15 floors, and both slots clear the 0.10 chroma floor and 3:1 on the
 *   surface.
 * * `#ff9e0d,#d48100,#aa6600,#814d00` as an ordinal ramp — every check passes;
 *   monotone lightness, all step gaps above 0.06, light end 2.07:1 against the
 *   surface, hue spread 1°.
 *
 * **These were re-derived for the new palette, not recoloured by hand.** The
 * theme's third colour is an ochre at OKLCH hue 66°; the ramp and slot 1 are
 * steps on that hue, found by taking the most chromatic in-gamut colour at
 * each target lightness and then letting the validator accept or reject it.
 * Three things the derivation settled that guesswork would not have:
 *
 * 1. **The primary brown cannot be a chart colour.** `#73362a` is OKLCH L
 *    0.411 — below the 0.43 light-mode band — and chroma 0.089, below the 0.10
 *    floor, so it reads as grey at chart size. Pushed to a passing chroma at
 *    its own hue (33°) it becomes `#ce2700`, a vivid red-orange that is no
 *    longer brown and collides with the error red. The brand's darkest colour
 *    is a good colour for a filled app bar and a bad one for a bar chart.
 * 2. **The second slot has to be cool.** Brown against ochre measures fine on
 *    paper but leaves the two warm hues carrying a two-series chart; the pair
 *    actually shipped is warm against cool, which is what survives protanopia
 *    with room to spare.
 * 3. **The ramp's light end is a floor, not a preference.** The first attempt
 *    started at L 0.82 (`#ffb15c`) and failed at 1.80:1 — "Low" would have
 *    dissolved into the white card. L 0.78 is the lightest step that clears
 *    2:1, and the other three are evenly spaced below it.
 *
 * The previous pair, `#2a78d6,#eb6834`, still passes every check: the card
 * surface did not move, so nothing forced this change. It changed because a
 * blue-and-orange chart inside a cream-and-brown application looks like it was
 * imported from somewhere else.
 */

/** Categorical slot 1. Every single-series bar chart, and "created" on the flow chart. */
export const SERIES_PRIMARY = '#b46d00';

/** Categorical slot 2. The second series on the flow chart, and nothing else. */
export const SERIES_SECONDARY = '#007ca5';

/**
 * The priority ramp, least to most urgent.
 *
 * Four steps of one ochre hue — the theme's third colour. The lightest step is
 * the ramp's floor for a light surface, not a choice: one step lighter is
 * 1.80:1 against a white card, and "Low" dissolves into it.
 */
export const PRIORITY_RAMP: Record<IncidentPriority, string> = {
  LOW: '#ff9e0d',
  MEDIUM: '#d48100',
  HIGH: '#aa6600',
  CRITICAL: '#814d00',
};

/**
 * Gap between neighbouring bars, as a fraction of the band.
 *
 * Wider than the library's default on purpose: thin marks with room around
 * them read as a chart, and blocks that touch read as a stack.
 */
export const CATEGORY_GAP_RATIO = 0.45;

/** Corner radius on the data end of a bar, in pixels. */
export const BAR_RADIUS = 4;
