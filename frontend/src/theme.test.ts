import { describe, expect, it } from 'vitest';

import { theme } from './theme';

/**
 * The typography decisions that are easy to undo by accident.
 *
 * Naming a font in a theme does not install one. Until M5.1 the stack led with
 * two fonts that were neither bundled nor linked, so every browser fell through
 * to Helvetica — which resolves to Nimbus Sans on Linux and sits 0.26em high in
 * its own line box, leaving visibly more space under a label than over it.
 */

/** Families in the theme's stack, in order. */
const families = theme.typography.fontFamily?.split(',').map((name) => name.trim()) ?? [];

describe('the font stack', () => {
  it('leads with the family that is actually self-hosted', () => {
    // `src/fonts.ts` bundles Inter and nothing else, so anything ahead of it
    // here would be a family the app hopes the operating system happens to
    // have — which is how the original fault arose.
    expect(families[0]).toBe('Inter');
  });

  it('ends at a generic family, so there is always something to render', () => {
    expect(families.at(-1)).toBe('sans-serif');
  });

  it('prefers Arial to Helvetica in the degraded case', () => {
    // Both are fallbacks that only matter if the webfont fails, but they are
    // not equivalent: Arial resolves to metrics that centre almost evenly,
    // while Helvetica resolves to Nimbus Sans and reintroduces the lean.
    expect(families.indexOf('Arial')).toBeLessThan(families.indexOf('Helvetica'));
  });

  it('asks only for weights the bundled font provides', () => {
    // `fonts.ts` imports 400, 500, 600 and 700. A weight named here but not
    // imported there is synthesised by the browser, which smears the nearest
    // one and undoes the reason for self-hosting.
    const bundled = [400, 500, 600, 700];
    const declared = [
      theme.typography.h1.fontWeight,
      theme.typography.h2.fontWeight,
      theme.typography.h3.fontWeight,
      theme.typography.button.fontWeight,
      theme.typography.fontWeightRegular,
      theme.typography.fontWeightMedium,
      theme.typography.fontWeightBold,
    ];

    for (const weight of declared) {
      expect(bundled).toContain(Number(weight));
    }
  });
});
