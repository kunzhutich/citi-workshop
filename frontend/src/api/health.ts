import { apiClient } from './client';

export type DependencyState = 'ok' | 'error';
export type ServiceState = 'ok' | 'degraded';

/** Result of the API's PostgreSQL connectivity probe. */
export interface DatabaseHealth {
  status: DependencyState;
  version: string | null;
  detail: string | null;
}

/** Response body of `GET /api/v1/health`. Mirrors `app/schemas/health.py`. */
export interface HealthReport {
  status: ServiceState;
  environment: 'local' | 'aws';
  api_version: string;
  checked_at: string;
  database: DatabaseHealth;
}

/** Fetch the API's health report. */
export async function fetchHealth(): Promise<HealthReport> {
  const { data } = await apiClient.get<HealthReport>('/health');
  return data;
}
