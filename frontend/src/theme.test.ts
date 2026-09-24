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
  it('leads with the families that are actually self-hosted', () => {
    // `src/fonts.ts` bundles Roboto and Inter, so anything ahead of them here
    // would be a family the app hopes the operating system happens to have —
    // which is how the original fault arose. Roboto is first, so it is the one
    // that renders; Inter is fetched only if Roboto's files cannot be.
    expect(families.slice(0, 2)).toEqual(['Roboto', 'Inter']);
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
    // `fonts.ts` imports 400, 500, 600 and 700 of both families. A weight
    // named here but not imported there is synthesised by the browser, which
    // smears the nearest one and undoes the reason for self-hosting.
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

/**
 * The contrast figures the palette's comment claims, asserted.
 *
 * S6 pinned four status colours against white *and* against the page
 * background, and wrote the eight numbers into `theme.ts`. Nothing checked
 * them. Changing `background.default` from `#f4f6fa` to the redesign's cream
 * `#f0eada` dropped three of the four below 4.5:1 and the suite stayed green —
 * the failure the redesign brief predicted, in the words "neither will fail
 * loudly".
 *
 * It is loud now. These are the two surfaces a chip is actually drawn on, read
 * off the theme rather than written down again, so moving either one re-runs
 * every figure.
 */
describe('the status palette against the surfaces it is drawn on', () => {
  /** Relative luminance, the formula WCAG contrast is built on. */
  function luminance(hex: string): number {
    const channels = [1, 3, 5].map((offset) => {
      const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function contrast(a: string, b: string): number {
    const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (lighter + 0.05) / (darker + 0.05);
  }

  /** Every slot a chip or a workflow button paints itself with. */
  const slots = {
    primary: theme.palette.primary.main,
    secondary: theme.palette.secondary.main,
    workflow: theme.palette.workflow.main,
    info: theme.palette.info.main,
    warning: theme.palette.warning.main,
    success: theme.palette.success.main,
    error: theme.palette.error.main,
  };

  it.each(Object.entries(slots))(
    '%s is readable as a filled chip, which is white text on the colour',
    (_slot, colour) => {
      expect(contrast(colour, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(Object.entries(slots))(
    '%s is readable as an outlined chip on a card',
    (_slot, colour) => {
      expect(contrast(colour, theme.palette.background.paper)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(Object.entries(slots))(
    '%s is readable as an outlined chip on the page itself',
    (_slot, colour) => {
      // The one S6 got right and nothing kept right. `PriorityChip` is
      // outlined and appears on every row of every list, so the page is not a
      // hypothetical surface for these colours — it is the common one.
      expect(contrast(colour, theme.palette.background.default)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('draws a focus ring that can be seen on the page', () => {
    // Non-text, so 3:1 rather than 4.5. The ring is `primary.main` and the
    // page is now a mid-cream rather than a near-white, which is exactly the
    // kind of change that quietly erodes a focus indicator.
    expect(contrast(theme.palette.primary.main, theme.palette.background.default)).toBeGreaterThan(
      3,
    );
  });
});

/**
 * The one focus ring, and the controls it has had to be lifted off.
 *
 * S6 gave the application a single global ring — `body :focus-visible`, three
 * brown pixels on everything — and twice since, the element it landed on has
 * turned out not to be the control. D46 records the first: inside a text field
 * the focusable element is the bare `<input>`, so the app bar's search box drew
 * a hard rectangle inside its own rounded outline. A date picker is the second,
 * and worse, because its focusable elements are the day, the month and the year
 * *separately*, so the ring boxed whichever two characters a reader clicked.
 *
 * Both fixes have the same two-rule shape — take the ring off the focusable
 * element, put it back on the field around it — and both are one selector away
 * from silently doing nothing at all. That is what is pinned here: not the
 * strings, which `DateRangeFields.test.tsx` checks against a real picker, but
 * that the two rules exist, that they are each other's halves, and that the
 * ring a picker draws is the same one as everywhere else.
 */
describe('the focus ring a date picker draws', () => {
  /**
   * `CssBaseline`'s global rules, as the object Material UI hands to Emotion.
   *
   * The theme states them as a function of itself, because the ring is painted
   * in `palette.primary.main` rather than in a literal. Calling it here is what
   * lets a test read the same values the browser is given.
   */
  function baselineRules(): Record<string, { outline?: string; outlineOffset?: number }> {
    const overrides = theme.components?.MuiCssBaseline?.styleOverrides;
    if (typeof overrides !== 'function') {
      throw new Error('CssBaseline no longer states its rules as a function of the theme');
    }
    return overrides(theme) as Record<string, { outline?: string; outlineOffset?: number }>;
  }

  const rules = baselineRules();

  /** The rule every other focusable thing in the application is ringed by. */
  const GLOBAL_RING = 'body :focus-visible';

  /** Found rather than named, so a renamed class fails rather than diverges. */
  const suppressed =
    Object.keys(rules).find(
      (selector) => selector.includes('Pickers') && rules[selector].outline === 'none',
    ) ?? '';

  it('takes the global ring off a picker section', () => {
    // The reported fault: a picker's focusable elements are its day, month and
    // year sections individually, so the global rule boxed whichever two
    // characters the reader had clicked on.
    expect(suppressed).not.toBe('');
    expect(suppressed).toContain(':focus-visible');
  });

  it('puts no ring back, which is the part that needs saying', () => {
    // Two replacements were tried and both were wrong on screen — one drew
    // through the field's floating label, one drew a hard rectangle inside a
    // rounded one (D46's own fault, reintroduced). There was nothing to
    // replace: a focused picker field already goes from a 1px notch to a 2px
    // `primary.main` one, exactly like every other outlined field here, none
    // of which wears a ring either.
    //
    // A suppression with no replacement is what S6 was raised to stop, so it
    // is asserted deliberately rather than left as an absence somebody tidies
    // away. `DateRangeFields.test.tsx` holds the other half: that the field is
    // marked `Mui-focused`, which is what that notch is drawn from.
    const pickerRules = Object.keys(rules).filter((selector) => selector.includes('Pickers'));
    expect(pickerRules).toEqual([suppressed]);
  });

  it('leaves every other ring in the application alone', () => {
    // The blast radius. S6 found this app had no visible focus at all and an
    // axe run said nothing about it, so the global rule is the one thing here
    // that must not be narrowed by accident.
    expect(rules[GLOBAL_RING].outline).toContain(theme.palette.primary.main);
    expect(rules[GLOBAL_RING].outline).toContain('3px');
  });
});
