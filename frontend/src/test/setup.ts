// Registers jest-dom's matchers (toBeInTheDocument, toHaveTextContent, ...)
// with Vitest's expect.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import { installMatchMedia, resetViewportWidth } from './viewport';

// react-responsive captures window.matchMedia on first import, so the stub has
// to be in place before any test module loads.
installMatchMedia();

// Testing Library only auto-cleans when Vitest globals are enabled. We keep
// globals off and import explicitly, so unmount rendered trees by hand —
// otherwise each test's DOM leaks into the next one's queries.
afterEach(() => {
  cleanup();
  resetViewportWidth();
});
