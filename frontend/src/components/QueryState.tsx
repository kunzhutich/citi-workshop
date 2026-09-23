import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

import { describeError } from '../api/errors';

export interface QueryStateProps {
  isPending: boolean;
  error: unknown;
  /** Shown when the request failed and said nothing more useful. */
  errorFallback: string;
  /** Announced, and shown, while the request is in flight. */
  loadingLabel?: string;
  children: ReactNode;
}

/**
 * The three states every fetched screen has, rendered the same way each time.
 *
 * Without this, each screen invents its own spinner placement and its own
 * phrasing for a failure, and the ones written last get the least attention.
 * `children` is only rendered once the data is really there, so a screen's own
 * code never has to handle `undefined`.
 */
export function QueryState({
  isPending,
  error,
  errorFallback,
  loadingLabel = 'Loading…',
  children,
}: QueryStateProps) {
  if (isPending) {
    /*
     * `role="status"` makes this a polite live region, so a screen reader is
     * told the screen is loading and, when this branch is replaced by the
     * content, that it finished. Without it the spinner is an image nobody is
     * pointed at: the page simply goes quiet for as long as the request takes
     * and then quietly changes underneath the user.
     *
     * The visible label is a real sentence rather than an `aria-label` on the
     * spinner, because a live region announces its *text*, and an empty region
     * announces nothing at all.
     */
    return (
      <Box
        role="status"
        aria-live="polite"
        aria-busy
        sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 6 }}
      >
        <CircularProgress aria-hidden />
        <Typography variant="body2" color="text.secondary">
          {loadingLabel}
        </Typography>
      </Box>
    );
  }

  if (error) {
    // MUI's Alert carries role="alert", which is an assertive live region, so
    // a failure that arrives after the user has moved on still reaches them.
    return <Alert severity="error">{describeError(error, errorFallback).message}</Alert>;
  }

  return <>{children}</>;
}

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

/**
 * What a list shows when it has nothing in it.
 *
 * An empty table with headers reads as broken; a sentence saying why it is
 * empty reads as working. Every list in the app uses this rather than
 * rendering zero rows.
 */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <Box sx={{ textAlign: 'center', py: 6, px: 2 }}>
      <Typography variant="h3" component="p" gutterBottom>
        {title}
      </Typography>
      {description ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: action ? 3 : 0 }}>
          {description}
        </Typography>
      ) : null}
      {action}
    </Box>
  );
}
