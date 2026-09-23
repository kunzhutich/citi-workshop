import { describe, expect, it } from 'vitest';

import { INCIDENT_PRIORITIES } from '../../display/labels';
import { PRIORITY_RAMP, SERIES_PRIMARY, SERIES_SECONDARY } from './chartPalette';

/**
 * The chart palette's structural promises.
 *
 * These do **not** re-derive the colour-blindness measurements — those were
 * computed with the data-visualisation validator against this application's
 * own white card surface, and the results are recorded in `chartPalette.ts`.
 * A test that reimplemented OKLab would be testing its own arithmetic.
 *
 * What is worth guarding here is the shape the reasoning depends on: the ramp
 * is monotone and one hue, the two categorical slots are genuinely different,
 * and every priority has a step. A future edit that nudges one hex is exactly
 * the change that would silently break the first two.
 */

/** Relative luminance, the same formula WCAG contrast is built on. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Hue in degrees, from the usual RGB-to-HSL conversion. */
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) {
    return 0;
  }
  const delta = max - min;
  const raw =
    max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return raw * 60;
}

describe('the priority ramp', () => {
  it('has a step for every priority, so no bar falls back to a default', () => {
    for (const priority of INCIDENT_PRIORITIES) {
      expect(PRIORITY_RAMP[priority]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('gets darker as the priority rises', () => {
    // The ramp's whole justification: priority is an *ordered* scale, so
    // more-urgent-is-darker is information. If a step were edited out of
    // order the chart would still draw, and would be lying.
    const order = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
    const luminances = order.map((priority) => luminance(PRIORITY_RAMP[priority]));

    for (let index = 1; index < luminances.length; index += 1) {
      expect(luminances[index]).toBeLessThan(luminances[index - 1]);
    }
  });

  it('stays one hue, which is what makes it a ramp rather than a palette', () => {
    const hues = Object.values(PRIORITY_RAMP).map(hue);
    expect(Math.max(...hues) - Math.min(...hues)).toBeLessThan(15);
  });

  it('keeps its lightest step dark enough to be seen on a white card', () => {
    // Below roughly 2:1 against the surface the "Low" bar dissolves into the
    // card behind it. The validator's ordinal floor for a light surface.
    const contrast = (luminance('#ffffff') + 0.05) / (luminance(PRIORITY_RAMP.LOW) + 0.05);
    expect(contrast).toBeGreaterThan(2);
  });
});

describe('the two categorical slots', () => {
  it('are a warm and a cool hue, far enough apart to tell apart', () => {
    // Used together on the only two-series chart. The validator measured the
    // pair at ΔE 24.7 under protanopia; this is the cheap structural guard
    // that they have not been edited into neighbours.
    const separation = Math.abs(hue(SERIES_PRIMARY) - hue(SERIES_SECONDARY));
    expect(Math.min(separation, 360 - separation)).toBeGreaterThan(90);
  });

  it('both clear 3:1 against the white card they are drawn on', () => {
    for (const colour of [SERIES_PRIMARY, SERIES_SECONDARY]) {
      const contrast = (luminance('#ffffff') + 0.05) / (luminance(colour) + 0.05);
      expect(contrast).toBeGreaterThan(3);
    }
  });
});
