import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HealthReport } from '../../api/health';
import { StatusPage } from './StatusPage';

vi.mock('../../api/health', () => ({ fetchHealth: vi.fn() }));

const { fetchHealth } = await import('../../api/health');
const fetchHealthMock = vi.mocked(fetchHealth);

const healthyReport: HealthReport = {
  status: 'ok',
  environment: 'local',
  api_version: '1.0.0',
  checked_at: '2026-01-01T12:00:00Z',
  database: { status: 'ok', version: 'PostgreSQL 17.7', detail: null },
};

describe('StatusPage', () => {
  beforeEach(() => {
    fetchHealthMock.mockReset();
  });

  it('shows the API and database as healthy', async () => {
    fetchHealthMock.mockResolvedValue(healthyReport);

    renderPage(<StatusPage />);

    expect(await screen.findByText('API healthy')).toBeInTheDocument();
    expect(screen.getByText('Database ok')).toBeInTheDocument();
    expect(screen.getByText('Environment: local')).toBeInTheDocument();
    expect(screen.getByText('PostgreSQL 17.7')).toBeInTheDocument();
  });

  it('shows a degraded API when the database probe failed', async () => {
    fetchHealthMock.mockResolvedValue({
      ...healthyReport,
      status: 'degraded',
      database: { status: 'error', version: null, detail: 'OperationalError' },
    });

    renderPage(<StatusPage />);

    expect(await screen.findByText('API degraded')).toBeInTheDocument();
    expect(screen.getByText('Database error')).toBeInTheDocument();
    expect(screen.getByText(/OperationalError/)).toBeInTheDocument();
  });

  it('shows an error when the API cannot be reached at all', async () => {
    fetchHealthMock.mockRejectedValue(new Error('Network Error'));

    renderPage(<StatusPage />);

    expect(await screen.findByText('The API could not be reached.')).toBeInTheDocument();
    expect(screen.getByText('Network Error')).toBeInTheDocument();
  });
});

/** Render a component with the providers the app supplies at runtime. */
function renderPage(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}
