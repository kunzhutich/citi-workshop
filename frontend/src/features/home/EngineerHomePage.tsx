import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';

import type { CurrentUser, IncidentListItem } from '../../api/types';
import { useSnackbar } from '../../components/SnackbarContext';
import { EmptyState, QueryState } from '../../components/QueryState';
import { StatTile, StatTileGrid } from '../dashboard/StatTile';
import { useMyReport } from '../dashboard/hooks';
import { usePickUpIncident, useIncidents } from '../incidents/hooks';
import { paths } from '../../routes';
import { HomeTicketRow } from './HomeTicketRow';
import { sortByPriorityThenAge } from './sortTickets';

/** How many rows each list shows before deferring to the full screen. */
const LIST_LIMIT = 6;

export interface EngineerHomePageProps {
  user: CurrentUser;
}

/**
 * What an engineer sees when they sign in: their work, then work to take on.
 *
 * **The four tiles are current state, not a period.** `/reports/me` takes no
 * date range (decision D9), and the counts are claims about what this person
 * is holding right now.
 *
 * That has one visible consequence worth stating. BUILD-PLAN section 10 names
 * the fourth tile "Resolved this week", and no endpoint an engineer may call
 * can answer that: `/reports/me` is current-state by design, and
 * `/reports/engineer-workload` — which does carry a period-scoped
 * `resolved_in_period` — is admin-only, because an engineer who could read it
 * could rank their colleagues. The tile therefore counts what the API can
 * honestly report: tickets this engineer has resolved that are **still
 * waiting** for the reporter to confirm. That is a number they can act on,
 * which "resolved this week" mostly is not. See decision D14.
 *
 * **Pick up is for SENIOR and LEAD only**, which is a rule the API owns
 * (`services/assignment.py` refuses a JUNIOR). A junior sees the sentence the
 * build plan specifies instead of an empty queue, because an empty queue would
 * read as "there is nothing to pick up" rather than "this is not how you get
 * work".
 */
export function EngineerHomePage({ user }: EngineerHomePageProps) {
  const counts = useMyReport();
  const level = user.engineer_profile?.level;
  const mayPickUp = level === 'SENIOR' || level === 'LEAD';

  // Sorted by priority on the server; the client settles ties by age below.
  const active = useIncidents({
    mine: 'assigned',
    status: ['OPEN', 'IN_PROGRESS', 'BLOCKED'],
    sort: '-priority',
    page_size: LIST_LIMIT,
  });

  const unassigned = useIncidents(
    {
      assignee_id: 'unassigned',
      status: ['OPEN'],
      specialty: true,
      sort: '-priority',
      page_size: LIST_LIMIT,
    },
    mayPickUp,
  );

  const assigned = counts.data?.assigned;
  const myActive = sortByPriorityThenAge(active.data?.items ?? []);

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h1" component="h1">
          Your work
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          What is on your plate, most urgent first.
        </Typography>
      </Box>

      <Box>
        <QueryState
          isPending={counts.isPending}
          error={counts.error}
          errorFallback="Could not load your ticket counts."
        >
          <StatTileGrid minWidth={160}>
            <StatTile
              label="Assigned, not started"
              value={assigned?.open ?? 0}
              caption="Yours, still open"
              to={`${paths.myQueue}?status=OPEN`}
            />
            <StatTile
              label="In progress"
              value={assigned?.in_progress ?? 0}
              caption="You are working on these"
              to={`${paths.myQueue}?status=IN_PROGRESS`}
            />
            <StatTile
              label="Blocked"
              value={assigned?.blocked ?? 0}
              caption="Stalled, waiting on something"
              to={`${paths.myQueue}?status=BLOCKED`}
            />
            <StatTile
              label="Resolved, awaiting confirmation"
              value={assigned?.resolved ?? 0}
              caption="Fixed, waiting on the reporter"
              to={`${paths.myQueue}?status=RESOLVED`}
            />
          </StatTileGrid>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Your tickets as they stand now, however long ago they were reported.
          </Typography>
        </QueryState>
      </Box>

      <Box>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 2,
            mb: 1,
          }}
        >
          <Typography variant="h2" component="h2">
            My active tickets
          </Typography>
          <Button component={RouterLink} to={paths.myQueue} size="small">
            See my queue
          </Button>
        </Box>

        <QueryState
          isPending={active.isPending}
          error={active.error}
          errorFallback="Could not load your tickets."
        >
          {myActive.length === 0 ? (
            <EmptyState
              title="Nothing is assigned to you"
              description={
                mayPickUp
                  ? 'Pick something up from the queue below, or wait for your lead to assign you work.'
                  : 'Work assigned to you by your lead or an admin appears here.'
              }
            />
          ) : (
            <Stack spacing={1.5}>
              {myActive.map((incident) => (
                <HomeTicketRow key={incident.id} incident={incident} />
              ))}
            </Stack>
          )}
        </QueryState>
      </Box>

      {mayPickUp ? (
        <UnassignedInSpecialties
          incidents={unassigned.data?.items ?? []}
          isPending={unassigned.isPending}
          error={unassigned.error}
        />
      ) : (
        <Alert severity="info">New tickets are assigned to you by your lead or admin.</Alert>
      )}
    </Stack>
  );
}

function UnassignedInSpecialties({
  incidents,
  isPending,
  error,
}: {
  incidents: IncidentListItem[];
  isPending: boolean;
  error: unknown;
}) {
  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 2,
          mb: 1,
        }}
      >
        <Typography variant="h2" component="h2">
          Unassigned in your specialties
        </Typography>
        <Button component={RouterLink} to={paths.unassigned} size="small">
          See all unassigned
        </Button>
      </Box>

      <QueryState
        isPending={isPending}
        error={error}
        errorFallback="Could not load the unassigned queue."
      >
        {incidents.length === 0 ? (
          <EmptyState
            title="Everything in your specialties is picked up"
            description="No open ticket in your groups is waiting for an owner."
          />
        ) : (
          <Stack spacing={1.5}>
            {sortByPriorityThenAge(incidents).map((incident) => (
              <HomeTicketRow
                key={incident.id}
                incident={incident}
                actions={<PickUpButton incident={incident} />}
              />
            ))}
          </Stack>
        )}
      </QueryState>
    </Box>
  );
}

/**
 * Take one unassigned ticket.
 *
 * The API owns the rule: `POST /incidents/{id}/pick-up` refuses a JUNIOR and
 * refuses a ticket that is not unassigned and OPEN. This button is only drawn
 * on a screen the level check has already passed, and a race — two engineers
 * pressing it on the same ticket — surfaces as the API's own error rather than
 * as a client-side guess about who won.
 */
function PickUpButton({ incident }: { incident: IncidentListItem }) {
  const { notify } = useSnackbar();
  const pickUp = usePickUpIncident();

  return (
    <Button
      variant="outlined"
      size="small"
      loading={pickUp.isPending}
      onClick={() => {
        pickUp.mutate(incident.id, {
          onSuccess: () => notify(`${incident.reference} is yours.`),
        });
      }}
    >
      Pick up
    </Button>
  );
}

