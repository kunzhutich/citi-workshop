import { createContext, use } from 'react';

/**
 * The application's one-line feedback channel.
 *
 * Split from its provider for the same reason `AuthContext` is: a module that
 * exports both a hook and a component loses Vite's Fast Refresh, so the
 * context and the hook live here and the component lives beside them.
 */

/** How a message is coloured. Matches Material UI's `Alert` severities. */
export type SnackbarSeverity = 'success' | 'info' | 'warning' | 'error';

export interface SnackbarContextValue {
  /** Show a message. Replaces whatever is on screen. */
  notify: (message: string, severity?: SnackbarSeverity) => void;
}

export const SnackbarContext = createContext<SnackbarContextValue | null>(null);

/**
 * Read the snackbar.
 *
 * Throws when there is no provider above, rather than returning a no-op:
 * silently swallowing every message the day the provider is moved would be a
 * far harder fault to find than a crash on the first render.
 */
export function useSnackbar(): SnackbarContextValue {
  const value = use(SnackbarContext);
  if (!value) {
    throw new Error('useSnackbar must be used inside a SnackbarProvider');
  }
  return value;
}
