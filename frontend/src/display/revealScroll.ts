/**
 * Bring something that has just appeared into view, without fighting the
 * operating system.
 *
 * Two screens reveal content below the fold on a phone — the facilities page
 * when a floor is chosen, and the report questionnaire as each question opens
 * — and on both of them a tap that fills a panel a screenful down looks like a
 * tap that did nothing.
 *
 * **`prefers-reduced-motion` has to be checked here, in JavaScript.**
 * `theme.ts` sets `scroll-behavior: auto !important` for that case, which
 * covers scrolling the stylesheet causes. It does not cover this: passing
 * `behavior: 'smooth'` to `scrollIntoView` is an explicit instruction that
 * overrides the stylesheet rather than obeying it. Someone who has asked their
 * system for less motion would get the animation anyway.
 *
 * `matchMedia` is optional-chained because jsdom does not always provide it,
 * and a component that cannot render in a unit test is worse than one that
 * assumes motion is fine there.
 */
export function revealScroll(element: HTMLElement | null): void {
  if (element === null) {
    return;
  }

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  element.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}
