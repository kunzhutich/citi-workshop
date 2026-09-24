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
 * * `#2a78d6,#eb6834` as a categorical pair — every check passes; worst CVD
 *   ΔE 24.7, normal-vision ΔE 33.6, both above the 8 and 15 floors.
 * * `#86b6ef,#5598e7,#2a78d6,#184f95` as an ordinal ramp — every check passes;
 *   monotone lightness, all step gaps above 0.06, light end 2.11:1 against the
 *   surface, hue spread 3°.
 *
 * A five-colour set following the *status chip* colours was tried first and
 * failed: blocked-orange beside resolved-green measures ΔE 3.2 under protanopia,
 * well under the floor, and closed-grey falls below the chroma floor. Those two
 * are adjacent in workflow order and workflow order is not ours to rearrange,
 * so the status chart uses one colour and lets its axis labels carry identity.
 * The chips are unaffected: they carry a word, so their colour never has to
 * stand alone.
 *
 * **These values went away in the redesign and came back, and the round trip is
 * worth a paragraph.** R2 re-derived the whole palette onto the theme's new
 * ochre hue — `#b46d00` against `#007ca5`, with an ochre ramp — and every check
 * passed there too. The owner reverted it for a reason this file should carry:
 * a chart is read by someone who has never seen this application before, and
 * blue is a convention they already have while brown is a brand they do not.
 * No measurement decided it; both palettes are legal. Coherence with the
 * interface lost to legibility to a stranger.
 *
 * What that discarded derivation established is still true, so it is kept here
 * rather than in a commit nobody will read:
 *
 * 1. **The brand brown cannot be a chart colour.** `#73362a` is OKLCH L 0.411 —
 *    below the 0.43 light-mode band — and chroma 0.089, below the 0.10 floor,
 *    so it reads as grey at chart size. Pushed to a passing chroma at its own
 *    hue it becomes `#ce2700`, a vivid red-orange that is no longer brown and
 *    collides with the error red. The brand's darkest colour is a good filled
 *    app bar and a bad bar chart.
 * 2. **A two-series chart needs a warm and a cool.** Two warm hues is the
 *    arrangement that fails protanopia, whichever two they are — which is what
 *    the blue-and-orange pair above has always been quietly getting right.
 * 3. **The ramp's lightest step is a floor, not a taste.** The ochre attempt
 *    started at OKLCH L 0.82 and failed at 1.80:1 against the card; "Low" would
 *    have dissolved into it. This ramp's light end is 2.11:1 for the same
 *    reason, and lightening it for prettiness would break the same check.
 *
 */

/** Categorical slot 1. Every single-series bar chart, and "created" on the flow chart. */
export const SERIES_PRIMARY = '#2a78d6';

/** Categorical slot 2. The second series on the flow chart, and nothing else. */
export const SERIES_SECONDARY = '#eb6834';

/**
 * The priority ramp, least to most urgent.
 *
 * Four steps of one blue hue. The lightest step is the ramp's floor for a light
 * surface — going lighter would let "Low" dissolve into the card behind it.
 */
export const PRIORITY_RAMP: Record<IncidentPriority, string> = {
  LOW: '#86b6ef',
  MEDIUM: '#5598e7',
  HIGH: '#2a78d6',
  CRITICAL: '#184f95',
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

/**
 * The four priority slices, for the pie on the admin dashboard.
 *
 * **Not the chip colours, and the gap between those two facts is the point.**
 * The owner asked for the chip colours here — sensibly, so the chart speaks
 * the language the rest of the application does. Run through the validator
 * they fail, and not marginally: the HIGH chip `#a94e08` against the CRITICAL
 * chip `#c72a2a` measures ΔE **8.5 under normal vision** and **1.9 under
 * deuteranopia**, against floors of 15 and 8. The two slices a reader most
 * needs to tell apart would be the same colour to a deuteranope and very
 * nearly the same to everybody else.
 *
 * That is not a flaw in the chips. A chip carries its own word half a
 * centimetre away, so its colour never has to carry identity alone — and the
 * chips are *dark* precisely because their labels must clear 4.5:1 on the
 * cream page, which is what pushes HIGH's orange down into CRITICAL's red.
 * A pie slice has no text on it and only needs 3:1 against the white card, so
 * it can be lighter and far more chromatic, which is exactly the room the two
 * hues needed.
 *
 * So these are the chip *hues* at slice steps: grey stays grey, blue stays
 * blue, red is the CRITICAL chip unchanged, and HIGH moves furthest — to a
 * true amber — because it is the one that was colliding.
 *
 *   LOW      #9e9c93  grey, like the `default` chip
 *   MEDIUM   #2a78d6  the `info` blue, lightened
 *   HIGH     #eda100  amber, where the chip is a dark orange
 *   CRITICAL #c72a2a  the `error` chip, unchanged
 *
 * Validator: CVD ΔE 14.0 (protan), normal-vision 16.6, both clear.
 *
 * **Two flags are accepted deliberately.** The grey trips the chroma floor,
 * which exists to stop a hue that is *trying* to be a colour from reading as
 * grey — LOW is meant to be neutral, mirroring its chip, and a neutral slice
 * beside three coloured ones is distinguishable *because* it is neutral. And
 * the grey and the amber sit under 3:1 against white, which the validator
 * calls a relief case: legal only with visible labels or a table view. Both
 * are present — every slice is labelled on the arc, and the card's table
 * toggle is one button away.
 */
export const PRIORITY_SLICES: Record<IncidentPriority, string> = {
  LOW: '#9e9c93',
  MEDIUM: '#2a78d6',
  HIGH: '#eda100',
  CRITICAL: '#c72a2a',
};

/**
 * Categorical slices for a pie with no inherent order — buildings.
 *
 * The first three slots of the validated categorical order, used in that
 * order and never cycled. Three is the cap here, not a coincidence: the
 * reference order clears the all-pairs gates for its first three slots and not
 * beyond, and a pie is an all-pairs chart because every slice touches the
 * legend and two of its neighbours. A fourth building folds into "Other" or
 * the chart goes back to being bars.
 *
 * Validator: CVD ΔE 9.2 (deutan), normal-vision 24.0. The aqua is 2.82:1
 * against white — the same relief case as above, met the same way.
 */
export const CATEGORICAL_SLICES: readonly string[] = ['#2a78d6', '#eb6834', '#1baf7a'];
