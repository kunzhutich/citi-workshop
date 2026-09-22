/**
 * A controllable `window.matchMedia` for tests.
 *
 * jsdom implements `matchMedia` but has no layout, so every width query reports
 * `matches: false` and `react-responsive` can never be exercised. The library
 * also captures `window.matchMedia` when it is first imported, which is why
 * `installMatchMedia` runs from the Vitest setup file rather than from
 * individual tests.
 */

/** Viewport width assumed when a test does not set one. */
export const DEFAULT_VIEWPORT_WIDTH = 1440;

let currentWidth = DEFAULT_VIEWPORT_WIDTH;

/** Pretend the browser window is `width` pixels wide from now on. */
export function setViewportWidth(width: number): void {
  currentWidth = width;
}

/** Restore the default viewport width. */
export function resetViewportWidth(): void {
  currentWidth = DEFAULT_VIEWPORT_WIDTH;
}

/** Replace `window.matchMedia` with one that answers from the stubbed width. */
export function installMatchMedia(): void {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: evaluate(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

/** Evaluate the width features of a media query against the stubbed width. */
function evaluate(query: string): boolean {
  const maxWidth = /max-width:\s*(\d+)px/.exec(query);
  if (maxWidth && currentWidth > Number(maxWidth[1])) {
    return false;
  }
  const minWidth = /min-width:\s*(\d+)px/.exec(query);
  if (minWidth && currentWidth < Number(minWidth[1])) {
    return false;
  }
  return Boolean(maxWidth ?? minWidth);
}
