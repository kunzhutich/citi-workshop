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
export function QueryState({ isPending, error, errorFallback, children }: QueryStateProps) {
  if (isPending) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress aria-label="Loading" />
      </Box>
    );
  }

  if (error) {
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
