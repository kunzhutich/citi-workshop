/**
 * The application's typefaces, self-hosted.
 *
 * **Why this file exists.** `theme.ts` asks for Inter and then Roboto, but
 * naming a font does not install one. Until M5.1 neither was present, so every
 * browser fell through to Helvetica — which resolves to Nimbus Sans on Linux,
 * whose ascent is only 0.729em against a 0.718em cap height. The glyphs
 * therefore sat about 4px high inside every line box, leaving visibly more
 * space under a label than over it in buttons, navigation rows and text
 * fields.
 *
 * **Both families are bundled, and only one is downloaded.** A `@font-face`
 * family is fetched lazily, when something actually needs it, so Roboto costs
 * nothing on a normal load: Inter is first in the stack and renders. Roboto is
 * there for the case the stack has always claimed to handle but could not —
 * if Inter's file 404s or is blocked, the browser now reaches a real second
 * family instead of falling through to the metrics this fix exists to remove.
 * It is also the family Material UI's own component heights were calibrated
 * against, which makes it the right thing to fall onto.
 *
 * Measured lean in MUI's fixed-height containers, worst case of the three
 * (button, navigation row, outlined input):
 *
 * | Family      | Lean    | Notes                                    |
 * | ----------- | ------- | ---------------------------------------- |
 * | Inter       | 0.00px  | symmetric typo metrics; what renders     |
 * | Roboto      | 0.44px  | sub-pixel; the bundled fallback          |
 * | Nimbus Sans | 4.16px  | what rendered before, via Helvetica      |
 *
 * **Self-hosted, not a CDN link.** Vite bundles these files and CloudFront
 * serves them beside the rest of the app, so the page depends on no third
 * party and resolves nothing beyond its own origin.
 *
 * The four weights are the four the theme asks for: 400 body, 500
 * `subtitle2`, 600 headings and buttons, 700 the `overline` on the signed-out
 * screens. Adding a fifth to the theme means adding it here too, or the
 * browser will synthesise it by smearing the nearest one — `theme.test.ts`
 * guards that.
 */

// Inter — the family that renders.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';

// Roboto — fetched only if Inter cannot be.
import '@fontsource/roboto/latin-400.css';
import '@fontsource/roboto/latin-500.css';
import '@fontsource/roboto/latin-600.css';
import '@fontsource/roboto/latin-700.css';
