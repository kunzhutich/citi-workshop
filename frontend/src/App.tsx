import { Navigate, Route, Routes } from 'react-router-dom';

import { StatusPage } from './features/status/StatusPage';

/**
 * Route table.
 *
 * M1 serves a single page. Later phases add the auth routes, the persona home
 * pages and the guarded feature routes; the catch-all keeps deep links working
 * while those are still missing.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<StatusPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
