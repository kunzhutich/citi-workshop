import RefreshIcon from '@mui/icons-material/Refresh';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { isChunkLoadError } from './staleBundle';

/**
 * Catches a render error so one broken component does not blank the app.
 *
 * React unmounts the **entire** tree when a render throws and nothing catches
 * it. Without a boundary the result is a white page: no navigation, no
 * message, nothing to click, and a URL that will do it again on reload. That
 * is the failure mode this exists to replace.
 *
 * A class component because that is the only thing React offers — there is no
 * hook equivalent of `componentDidCatch`, in React 19 or any version before it.
 *
 * **It does not catch everything.** React error boundaries see errors thrown
 * while rendering, in lifecycle methods and in constructors below them. They do
 * not see errors thrown in event handlers, in `setTimeout`, or in a rejected
 * promise — those never unmount the tree, and are handled where they happen:
 * a failed request becomes an `Alert` through `QueryState`, and a failed
 * mutation becomes a snackbar.
 *
 * Used in two places, deliberately, because they fail differently:
 *
 * * around `<Outlet />` in `AppShell`, where the navigation survives so the
 *   user can go somewhere else. Keyed on the pathname, so navigating away
 *   resets it rather than leaving the fallback pinned to a route that works.
 * * around the whole tree in `main.tsx`, which catches the shell itself, the
 *   providers and anything outside the router. There is nothing left to
 *   navigate with there, so its only honest offer is a reload.
 */

export interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * What the fallback offers. `retry` re-renders the subtree, which is the
   * right move for a transient failure; `reload` reloads the document, which
   * is the only move left when the shell itself is what failed.
   */
  recovery?: 'retry' | 'reload';
  /** Named in the fallback, so a screenshot says which part broke. */
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The browser console is the only sink there is: this application has no
    // error-reporting endpoint, and inventing one that posts unvalidated
    // strings to the API would be a worse idea than a console line.
    console.error(`[${this.props.label ?? 'app'}] render failed`, error, info.componentStack);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    const { recovery = 'retry' } = this.props;
    // A missing chunk means the bundle moved under a tab that was left open —
    // retrying re-requests the same dead URL, and only a reload fetches the
    // new index.html. So the offer follows the cause rather than the prop.
    const staleBundle = isChunkLoadError(error);
    const offerReload = recovery === 'reload' || staleBundle;

    return (
      <Box sx={{ maxWidth: 640, mx: 'auto', py: 4 }}>
        <Alert severity="error" icon={<ReportProblemIcon />}>
          <AlertTitle>
            {staleBundle ? 'This page needs reloading' : 'Something went wrong on this screen'}
          </AlertTitle>
          {staleBundle
            ? 'The application was updated while this tab was open, so part of it could no longer be loaded. Reloading picks up the new version.'
            : 'The screen could not be displayed. Nothing you were looking at has been changed or lost.'}
        </Alert>

        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 2, fontFamily: 'monospace', wordBreak: 'break-word' }}
        >
          {error.message || error.name}
        </Typography>

        <Stack direction="row" spacing={1} sx={{ mt: 3, flexWrap: 'wrap', gap: 1 }}>
          {offerReload ? (
            <Button
              variant="contained"
              startIcon={<RefreshIcon />}
              onClick={() => window.location.reload()}
            >
              Reload the page
            </Button>
          ) : (
            <Button variant="contained" startIcon={<RefreshIcon />} onClick={this.reset}>
              Try again
            </Button>
          )}
        </Stack>
      </Box>
    );
  }
}
