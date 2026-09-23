/**
 * The application's typefaces, self-hosted.
 *
 * **Why this file exists.** `theme.ts` asks for Roboto and then Inter, but
 * naming a font does not install one. Until M5.1 neither was present, so every
 * browser fell through to Helvetica — which resolves to Nimbus Sans on Linux,
 * whose ascent is only 0.729em against a 0.718em cap height. The glyphs
 * therefore sat about 4px high inside every line box, leaving visibly more
 * space under a label than over it in buttons, navigation rows and text
 * fields.
 *
 * **Both families are bundled, and only one is downloaded.** A `@font-face`
 * family is fetched lazily, when something actually needs it, so Inter costs
 * nothing on a normal load: Roboto is first in the stack and renders. Inter is
 * there for the case the stack has always claimed to handle but could not — if
 * Roboto's file 404s or is blocked, the browser reaches a real second family
 * instead of falling through to the metrics this fix exists to remove.
 *
 * Measured lean in MUI's fixed-height containers, worst case of the three
 * (button, navigation row, outlined input):
 *
 * | Family      | Lean    | Notes                                          |
 * | ----------- | ------- | ---------------------------------------------- |
 * | Roboto      | 0.44px  | sub-pixel; what renders, and what Material UI's |
 * |             |         | component heights were calibrated against       |
 * | Inter       | 0.00px  | symmetric typo metrics; the bundled fallback    |
 * | Nimbus Sans | 4.16px  | what rendered before, via Helvetica             |
 *
 * Inter centres more exactly on paper, but 0.44px is below the threshold of a
 * single CSS pixel and Roboto is the family MUI is drawn around, so leading
 * with it is the better trade. Swapping the two in `theme.ts` is all it takes
 * to change that decision; `theme.test.ts` pins whichever order is chosen.
 *
 * **Self-hosted, not a CDN link.** Vite bundles these files and CloudFront
 * serves them beside the rest of the app, so the page depends on no third
 * party and resolves nothing beyond its own origin.
 *
 * The four weights are the four the theme asks for: 400 body, 500
 * `subtitle2`, 600 headings and buttons, 700 the `overline` on the signed-out
 * screens. Adding a fifth to the theme means adding it here too, or the
 * browser will synthesise it by smearing the nearest one — `theme.test.ts`
 * guards that. Note that `@fontsource/roboto` ships a 600 where upstream
 * Roboto historically did not.
 */

// Roboto — the family that renders.
import '@fontsource/roboto/latin-400.css';
import '@fontsource/roboto/latin-500.css';
import '@fontsource/roboto/latin-600.css';
import '@fontsource/roboto/latin-700.css';

// Inter — fetched only if Roboto cannot be.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
