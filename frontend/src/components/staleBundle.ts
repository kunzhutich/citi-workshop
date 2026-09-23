/**
 * Recognising a render failure that is really a stale bundle.
 *
 * Split from `ErrorBoundary.tsx` for the reason `actionAvailability.ts` is
 * split from its component: a module that exports both a component and a plain
 * function loses Vite's Fast Refresh, and eslint's `react-refresh` rule says
 * so.
 */

/**
 * Whether this error is a lazy-loaded chunk that could not be fetched.
 *
 * The admin dashboard is code-split, so a tab left open across a deploy asks
 * for a bundle filename that no longer exists. That surfaces as a render
 * error, and it is the one render error where "try again" is useless: the
 * retry re-requests the same dead URL. Only a reload fetches the new
 * `index.html` and with it the new filenames.
 *
 * Matched on the message because browsers disagree on the wording — Chrome
 * says "Failed to fetch dynamically imported module", Firefox says "error
 * loading dynamically imported module", and a bundler-wrapped one says
 * "ChunkLoadError".
 */
export function isChunkLoadError(error: Error): boolean {
  const text = `${error.name} ${error.message}`;
  return /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed/i.test(
    text,
  );
}
