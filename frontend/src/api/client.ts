import axios from 'axios';

/**
 * Every API path is relative and starts with `/api/v1`.
 *
 * There is deliberately no configurable base URL. The browser always talks to
 * the same origin it was served from: CloudFront in the cloud (one distribution
 * fronts both the S3 site and the Lambda), and the Vite dev server locally.
 * Same-origin in both environments means no CORS and a working `SameSite=Strict`
 * refresh cookie.
 */
export const API_BASE_URL = '/api/v1';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});
