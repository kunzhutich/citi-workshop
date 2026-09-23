import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';

/**
 * Build the rejection axios raises for an API error body.
 *
 * Screens read failures through `describeError`, which branches on the shape
 * of `response.data`, so a test that wants to exercise a 409 or a 422 has to
 * produce a real `AxiosError` rather than a plain `Error`.
 */
export function apiError(status: number, body: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() };
  const response = {
    data: body,
    status,
    statusText: 'Error',
    headers: new AxiosHeaders(),
    config,
  } as AxiosResponse;

  return new AxiosError('Request failed', String(status), config, null, response);
}
