import AddCircleOutlinedIcon from '@mui/icons-material/AddCircleOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';

import type { CurrentUser } from '../../api/types';
import { EmptyState, QueryState } from '../../components/QueryState';
import { StatTile, StatTileGrid } from '../dashboard/StatTile';
import { useMyReport } from '../dashboard/hooks';
import { useIncidents } from '../incidents/hooks';
import { InlineTransitionButtons } from '../incidents/InlineTransitionButtons';
import { paths } from '../../routes';
import { HomeTicketRow } from './HomeTicketRow';

/** How many tickets each of the two lists shows before deferring to My tickets. */
const LIST_LIMIT = 5;

export interface EmployeeHomePageProps {
  user: CurrentUser;
}

/**
 * What an employee sees when they sign in.
 *
 * The screen is ordered by what someone came here to do. Reporting a problem
 * is first and is a full-width button, because it is the only reason most
 * employees ever open this application and it should not be a thing to find.
 * Then the four counts, then — only when there is something in it — the
 * section that needs them to act, then what they have reported recently.
 *
 * **Every number here is current state.** `/reports/me` takes no date range at
 * all: "you have one open ticket" is a claim about now, and a ticket raised in
 * February and still open belongs on this screen (decision D9). There is no
 * period control on this page and nothing on it is labelled with one.
 *
 * The four tiles link into My tickets pre-filtered to the status they count,
 * so a reader who wants the list behind a number gets exactly the tickets that
 * produced it.
 */
export function EmployeeHomePage({ user }: EmployeeHomePageProps) {
  const counts = useMyReport();

  // Resolved tickets this person reported: the ones the workflow is waiting on
  // them to confirm. Sorted by the most recently touched, because the one an
  // engineer finished this morning is the one they can speak to.
  const awaiting = useIncidents({
    mine: 'reported',
    status: ['RESOLVED'],
    sort: '-updated_at',
    page_size: LIST_LIMIT,
  });

  const recent = useIncidents({
    mine: 'reported',
    sort: '-created_at',
    page_size: LIST_LIMIT,
  });

  const reported = counts.data?.reported;
  const needsAttention = awaiting.data?.items ?? [];

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h1" component="h1">
          {greeting()}, {firstName(user.full_name)}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Anything at work not right? Tell us and we will get someone on it.
        </Typography>
      </Box>

      <Button
        component={RouterLink}
        to={paths.report}
        variant="contained"
        size="large"
        fullWidth
        startIcon={<AddCircleOutlinedIcon />}
      >
        Report an issue
      </Button>

      <Box>
        <QueryState
          isPending={counts.isPending}
          error={counts.error}
          errorFallback="Could not load your ticket counts."
        >
          <StatTileGrid minWidth={160}>
            <StatTile
              label="Open"
              value={reported?.open ?? 0}
              caption="Waiting to be picked up"
              to={`${paths.myTickets}?status=OPEN`}
            />
            <StatTile
              label="In progress"
              value={reported?.in_progress ?? 0}
              caption="Someone is on it"
              to={`${paths.myTickets}?status=IN_PROGRESS`}
            />
            <StatTile
              label="Blocked"
              value={reported?.blocked ?? 0}
              caption="Stalled on parts, access or you"
              to={`${paths.myTickets}?status=BLOCKED`}
            />
            <StatTile
              label="Awaiting your confirmation"
              value={reported?.resolved ?? 0}
              caption="Fixed — tell us whether it worked"
              to={`${paths.myTickets}?status=RESOLVED`}
            />
          </StatTileGrid>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Your tickets as they stand now, however long ago you reported them.
          </Typography>
        </QueryState>
      </Box>

      {/*
        Shown only when non-empty, as BUILD-PLAN section 10 asks. An empty
        "Needs your attention" heading with a cheerful "nothing here" under it
        is a section that shouts for attention in order to say there is none —
        and it would push the recent tickets below the fold to do it.
      */}
      {needsAttention.length > 0 ? (
        <Box>
          <Typography variant="h2" component="h2" gutterBottom>
            Needs your attention
          </Typography>
          <Alert severity="info" sx={{ mb: 2 }}>
            These have been fixed. Confirm it worked and we will close the ticket — or tell us
            it is still broken and it goes straight back to the engineer.
          </Alert>
          <Stack spacing={1.5}>
            {needsAttention.map((incident) => (
              <HomeTicketRow
                key={incident.id}
                incident={incident}
                actions={
                  <InlineTransitionButtons
                    incidentId={incident.id}
                    reference={incident.reference}
                    // The API decides whether these are offered at all; this
                    // only says which of its answers belong on a home screen.
                    only={['Confirm fixed', 'Still broken']}
                  />
                }
              />
            ))}
          </Stack>
        </Box>
      ) : null}

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
            Your recent tickets
          </Typography>
          <Button component={RouterLink} to={paths.myTickets} size="small">
            See all
          </Button>
        </Box>

        <QueryState
          isPending={recent.isPending}
          error={recent.error}
          errorFallback="Could not load your tickets."
        >
          {(recent.data?.items ?? []).length === 0 ? (
            <EmptyState
              title="You have not reported anything yet"
              description="When something at work is not right, this is where it will be."
              action={
                <Button component={RouterLink} to={paths.report} variant="contained">
                  Report an issue
                </Button>
              }
            />
          ) : (
            <Stack spacing={1.5}>
              {(recent.data?.items ?? []).map((incident) => (
                <HomeTicketRow key={incident.id} incident={incident} />
              ))}
            </Stack>
          )}
        </QueryState>
      </Box>
    </Stack>
  );
}

/** "Good morning" / "Good afternoon" / "Good evening", by the reader's clock. */
function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) {
    return 'Good morning';
  }
  if (hour < 18) {
    return 'Good afternoon';
  }
  return 'Good evening';
}

/** The name someone would be greeted by. */
function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
