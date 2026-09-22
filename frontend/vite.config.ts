import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Vite dev server and test configuration.
 *
 * The dev proxy forwards `/api` to uvicorn **without rewriting the path**, which
 * is the whole point: CloudFront forwards `/api/v1*` to the Lambda unmodified,
 * so local and deployed paths must be identical. It also makes local development
 * same-origin, exactly like the deployed CloudFront distribution, so the
 * `SameSite=Strict` refresh cookie added in M2 behaves the same in both.
 *
 * `bin/proxy-server.js` is deliberately unused — it strips the `/api/<name>`
 * prefix, which would make local paths diverge from deployed ones.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
