import { Navigate, Route, Routes } from 'react-router-dom';

import { RequireAuth } from './auth/RequireAuth';
import { RequireRole } from './auth/RequireRole';
import { ChangePasswordPage } from './features/auth/ChangePasswordPage';
import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';
import { HomePage } from './features/home/HomePage';
import { ComingSoonPage } from './features/placeholder/ComingSoonPage';
import { StatusPage } from './features/status/StatusPage';
import { AppShell } from './layout/AppShell';
import { paths } from './routes';

/**
 * The route table.
 *
 * Three tiers, in the order a request meets them:
 *
 * 1. **Open** — sign in, register, and the status page the deployment
 *    checklist uses to prove a fresh environment before any account exists.
 * 2. **Signed in, gate skipped** — the change-password screen, which an
 *    account owing a password change must be able to reach.
 * 3. **Signed in, past the gate** — everything inside `AppShell`, with
 *    `RequireRole` narrowing the screens a role does not own.
 *
 * The guards are a courtesy to the user, never the enforcement: the API
 * refuses the same requests with 401 and 403 whatever the browser renders.
 */
export default function App() {
  return (
    <Routes>
      <Route path={paths.login} element={<LoginPage />} />
      <Route path={paths.register} element={<RegisterPage />} />
      <Route path="/status" element={<StatusPage />} />

      <Route element={<RequireAuth skipPasswordGate />}>
        <Route path={paths.changePassword} element={<ChangePasswordPage />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path={paths.home} element={<HomePage />} />

          <Route
            path={paths.report}
            element={
              <ComingSoonPage
                title="Report an issue"
                description="The guided questionnaire: what kind of problem, which one, where, what happened, and how urgent it is."
                phase="M6"
              />
            }
          />
          <Route
            path={paths.myTickets}
            element={
              <ComingSoonPage
                title="My tickets"
                description="Everything you have reported, with its status, priority and last update."
                phase="M6"
              />
            }
          />
          <Route
            path={paths.allTickets}
            element={
              <ComingSoonPage
                title="All tickets"
                description="Every incident, searchable and filterable by status, priority, category and location."
                phase="M6"
              />
            }
          />

          <Route element={<RequireRole roles={['ENGINEER']} />}>
            <Route
              path={paths.myQueue}
              element={
                <ComingSoonPage
                  title="My queue"
                  description="The tickets assigned to you, filterable by status and priority."
                  phase="M6"
                />
              }
            />
          </Route>

          <Route element={<RequireRole roles={['ENGINEER', 'FACILITY_ADMIN']} levels={['SENIOR', 'LEAD']} />}>
            <Route
              path={paths.unassigned}
              element={
                <ComingSoonPage
                  title="Unassigned"
                  description="Open tickets nobody has picked up, filtered to your specialties by default."
                  phase="M6"
                />
              }
            />
          </Route>

          <Route element={<RequireRole roles={['ENGINEER', 'FACILITY_ADMIN']} levels={['LEAD']} />}>
            <Route
              path={paths.team}
              element={
                <ComingSoonPage
                  title="Team"
                  description="Your engineers with their level, availability and current load, and the dialog for assigning work."
                  phase="M6"
                />
              }
            />
          </Route>

          <Route element={<RequireRole roles={['FACILITY_ADMIN']} />}>
            <Route
              path={paths.engineers}
              element={
                <ComingSoonPage
                  title="Engineers"
                  description="Add engineers with a level and specialties, and manage the ones you have."
                  phase="M6"
                />
              }
            />
            <Route
              path={paths.facilities}
              element={
                <ComingSoonPage
                  title="Facilities"
                  description="Buildings, their floors, and the desks and meeting rooms on each floor."
                  phase="M6"
                />
              }
            />
            <Route
              path={paths.categories}
              element={
                <ComingSoonPage
                  title="Categories"
                  description="The groups and subcategories the report questionnaire is built from."
                  phase="M6"
                />
              }
            />
            <Route
              path={paths.users}
              element={
                <ComingSoonPage
                  title="Users"
                  description="Everyone with an account, their role, and whether it is still active."
                  phase="M6"
                />
              }
            />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to={paths.home} replace />} />
    </Routes>
  );
}
