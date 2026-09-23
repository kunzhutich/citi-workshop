/**
 * The application's typeface, self-hosted.
 *
 * **Why this file exists at all.** `theme.ts` asks for Inter, but naming a font
 * does not install one. Until M5.1 neither Inter nor Roboto was present, so
 * every browser fell through the stack to Helvetica — which on the build
 * machine resolves to Nimbus Sans, whose `hhea` ascent is only 0.729em against
 * a 0.718em cap height. The glyphs therefore sat 0.26em high inside every line
 * box, about 3.6px at button size, leaving visibly more space under a label
 * than over it in every fixed-height container: buttons, navigation rows and
 * unfocused text fields.
 *
 * Inter's own metrics are symmetric to four decimal places — its cap-height
 * midpoint lands exactly on the centre of the line box — so loading it removes
 * the lean rather than merely changing it.
 *
 * **Self-hosted, not a CDN link.** These files are bundled by Vite and served
 * from the same CloudFront distribution as the rest of the app, so the page has
 * no third-party dependency and nothing to resolve at load time beyond its own
 * origin.
 *
 * **The stylesheet exception.** CLAUDE.md rules out `.css` files; it allows
 * them for "a third-party library that ships or demands a stylesheet", which is
 * exactly what `@fontsource` is. Each import below is one `@font-face` rule for
 * the latin subset of one weight — the narrowest form the package offers.
 *
 * The four weights are the four the theme and its components actually ask for:
 * 400 body, 500 `subtitle2`, 600 headings and buttons, 700 the `overline` on
 * the signed-out screens. Adding a fifth to the theme means adding it here, or
 * the browser will synthesise it by smearing the nearest one.
 */
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
