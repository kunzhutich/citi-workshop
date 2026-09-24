import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import { AuthProvider } from './auth/AuthProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SnackbarProvider } from './components/SnackbarProvider';
// Side-effect import: registers the @font-face rules theme.ts relies on.
import './fonts';
import { theme } from './theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Aurora Serverless v2 sleeps at min_capacity = 0 and takes about 15
      // seconds to wake, so a single retry is worth it, but no more.
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root is missing from index.html');
}

// AuthProvider sits inside BrowserRouter because the guards it feeds are
// routes, and outside App because every route depends on the session.
// SnackbarProvider wraps App rather than sitting inside the shell, so a screen
// outside the shell can confirm something too.
// The outer ErrorBoundary is inside ThemeProvider so its fallback is styled,
// and outside BrowserRouter because it has to survive the router failing.
// There is nothing to navigate with at that point, so it offers a reload.
// The per-route boundary in `AppShell` handles the ordinary case, where the
// navigation is still standing and "try again" is a real option.
// LocalizationProvider is here and nowhere else: every date picker in the
// application should parse and print dates the same way, and a provider per
// screen is how two screens quietly end up on different adapters. It sits
// inside ThemeProvider so a picker's popper is themed like everything else.
createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <ErrorBoundary label="application" recovery="reload">
            <BrowserRouter>
              <AuthProvider>
                <SnackbarProvider>
                  <App />
                </SnackbarProvider>
              </AuthProvider>
            </BrowserRouter>
          </ErrorBoundary>
        </LocalizationProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
