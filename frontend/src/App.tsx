import { Route, Routes } from 'react-router-dom';

import { RequireAuth } from './auth/RequireAuth';
import { RequireRole } from './auth/RequireRole';
import { ChangePasswordPage } from './features/auth/ChangePasswordPage';
import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';
import { CategoriesPage } from './features/categories/CategoriesPage';
import { EngineersPage } from './features/engineers/EngineersPage';
import { TeamPage } from './features/engineers/TeamPage';
import { FacilitiesPage } from './features/facilities/FacilitiesPage';
import { HomePage } from './features/home/HomePage';
import { IncidentDetailPage } from './features/incidents/IncidentDetailPage';
import { IncidentsPage } from './features/incidents/IncidentsPage';
import { ReportPage } from './features/incidents/ReportPage';
import { NotFoundPage } from './features/placeholder/NotFoundPage';
import { StatusPage } from './features/status/StatusPage';
import { UsersPage } from './features/users/UsersPage';
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
 *
 * The four ticket lists are one component with a different preset each. What
 * separates My Queue from Unassigned is an API filter, not a screen.
 *
 * The catch-all sits in tier 3 rather than at the top level, so an unknown URL
 * is explained by `NotFoundPage` inside the shell rather than silently
 * redirected.
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

          <Route path={paths.report} element={<ReportPage />} />

          <Route
            path={paths.myTickets}
            element={
              <IncidentsPage
                title="My tickets"
                description="Everything you have reported, newest first."
                preset={{ mine: 'reported' }}
                emptyTitle="You have not reported anything yet"
                emptyDescription="When something at work is not right, this is where it will be."
                offerReport
              />
            }
          />

          <Route
            path={paths.allTickets}
            element={
              <IncidentsPage
                title="All tickets"
                description="Every incident, so you can check whether yours is already reported."
                emptyTitle="No tickets yet"
                emptyDescription="Nothing has been reported in this workspace."
                offerReport
              />
            }
          />

          {/* Sibling of /tickets/mine, and safe: React Router ranks a static
              segment above a dynamic one. */}
          <Route path={paths.incidentDetail} element={<IncidentDetailPage />} />

          <Route element={<RequireRole roles={['ENGINEER']} />}>
            <Route
              path={paths.myQueue}
              element={
                <IncidentsPage
                  title="My queue"
                  description="The tickets assigned to you."
                  preset={{ mine: 'assigned' }}
                  emptyTitle="Nothing is assigned to you"
                  emptyDescription="Work assigned to you by a lead or an admin appears here."
                />
              }
            />
          </Route>

          <Route
            element={
              <RequireRole roles={['ENGINEER', 'FACILITY_ADMIN']} levels={['SENIOR', 'LEAD']} />
            }
          >
            <Route
              path={paths.unassigned}
              element={
                <IncidentsPage
                  title="Unassigned"
                  description="Open tickets nobody has picked up yet."
                  preset={{ assignee_id: 'unassigned', status: ['OPEN'] }}
                  emptyTitle="Everything is picked up"
                  emptyDescription="No open ticket is waiting for an owner."
                />
              }
            />
          </Route>

          <Route element={<RequireRole roles={['ENGINEER', 'FACILITY_ADMIN']} levels={['LEAD']} />}>
            <Route path={paths.team} element={<TeamPage />} />
          </Route>

          <Route element={<RequireRole roles={['FACILITY_ADMIN']} />}>
            <Route path={paths.engineers} element={<EngineersPage />} />
            <Route path={paths.facilities} element={<FacilitiesPage />} />
            <Route path={paths.categories} element={<CategoriesPage />} />
            <Route path={paths.users} element={<UsersPage />} />
          </Route>

          {/* Anything else, inside the shell so the navigation is still there
              to leave by. Signed out this is unreachable — `RequireAuth`
              redirects to the login screen first, which is the right answer:
              the application is not browsable without a session, and after
              signing in the bad URL resolves here where it can be explained.
              Replaces a `<Navigate to="/">` that rewrote the address bar and
              told the user nothing. */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
