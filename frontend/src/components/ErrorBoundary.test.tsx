import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../test/renderWithProviders';
import { ErrorBoundary } from './ErrorBoundary';
import { isChunkLoadError } from './staleBundle';

/**
 * What a render error does to the rest of the page.
 *
 * React writes the caught error to `console.error` itself, twice under
 * StrictMode, so every test here silences it — otherwise a passing run looks
 * like a failing one and a real console error would be lost in the noise.
 */

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function Boom({ message = 'the thing broke' }: { message?: string }): never {
  throw new Error(message);
}

describe('ErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    renderWithProviders(
      <ErrorBoundary>
        <p>the screen</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('the screen')).toBeInTheDocument();
  });

  it('shows a fallback instead of unmounting the tree', () => {
    renderWithProviders(
      <div>
        <p>the navigation</p>
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      </div>,
    );

    expect(screen.getByText('Something went wrong on this screen')).toBeInTheDocument();
    // The point of the whole exercise: what sat beside the failure survives.
    expect(screen.getByText('the navigation')).toBeInTheDocument();
  });

  it('says what actually went wrong rather than only that something did', () => {
    renderWithProviders(
      <ErrorBoundary>
        <Boom message="cannot read properties of undefined" />
      </ErrorBoundary>,
    );

    expect(screen.getByText('cannot read properties of undefined')).toBeInTheDocument();
  });

  it('latches until the user asks to retry, then renders the fixed subtree', async () => {
    /*
     * The harness flips the child from broken to working while the fallback
     * is on screen. The boundary must keep showing the fallback until the
     * user says so — a boundary that cleared itself on the next parent render
     * would flicker between the error and the screen on every state change
     * above it.
     */
    function Harness() {
      const [broken, setBroken] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setBroken(false)}>
            fix it
          </button>
          <ErrorBoundary>
            {broken ? <Boom message="transient" /> : <p>recovered content</p>}
          </ErrorBoundary>
        </>
      );
    }

    renderWithProviders(<Harness />);
    expect(screen.getByText('Something went wrong on this screen')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'fix it' }));
    expect(screen.getByText('Something went wrong on this screen')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('recovered content')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong on this screen')).not.toBeInTheDocument();
  });

  it('offers a reload rather than a retry when asked to', () => {
    renderWithProviders(
      <ErrorBoundary recovery="reload">
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('offers a reload for a stale bundle even when set to retry', () => {
    /*
     * A tab left open across a deploy asks for a chunk filename that no longer
     * exists. Retrying re-requests the same dead URL; only a reload fetches
     * the new `index.html`. So the offer follows the cause, not the prop.
     */
    renderWithProviders(
      <ErrorBoundary>
        <Boom message="Failed to fetch dynamically imported module: /assets/dash-a1b2.js" />
      </ErrorBoundary>,
    );

    expect(screen.getByText('This page needs reloading')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeInTheDocument();
  });

  it('announces the failure rather than only drawing it', () => {
    renderWithProviders(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    // MUI's Alert carries role="alert", so a screen reader is told without
    // the user having to go looking for what changed.
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong on this screen');
  });
});

describe('isChunkLoadError', () => {
  it.each([
    'ChunkLoadError: Loading chunk 7 failed',
    'Failed to fetch dynamically imported module: /assets/x.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
  ])('recognises %s', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  it('does not mistake an ordinary error for one', () => {
    expect(isChunkLoadError(new Error("cannot read properties of null (reading 'map')"))).toBe(
      false,
    );
  });
});
