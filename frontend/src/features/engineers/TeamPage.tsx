import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { PageHeader } from '../../components/PageHeader';
import { EmptyState, QueryState } from '../../components/QueryState';
import { relativeTime } from '../../display/time';
import { HomeTicketRow } from '../home/HomeTicketRow';
import { AssignButton } from '../incidents/AssignButton';
import { useIncidents } from '../incidents/hooks';
import { useCategoryTree } from '../categories/hooks';
import { EngineerRoster } from './EngineerRoster';
import { useEngineers } from './hooks';

/**
 * A lead engineer's view of their team, and the work waiting to be handed out.
 *
 * Two halves, in the order the decision is made: who has room, then what needs
 * an owner. Reading the roster first is the point — a lead assigning a ticket
 * without having just seen the load is guessing, and the capacity bars are the
 * answer to "who".
 *
 * The Assign button is the same dialog the ticket detail page opens. A second
 * one here would be a second place for the ordering and the capacity warnings
 * to live.
 */
export function TeamPage() {
  const engineers = useEngineers({ page_size: 100 });
  const categories = useCategoryTree();
  const unassigned = useIncidents({
    assignee_id: 'unassigned',
    status: ['OPEN'],
    sort: '-priority',
    page_size: 25,
  });

  return (
    <Box>
      <PageHeader
        title="Team"
        description="Who is available, how much they are carrying, and what still needs an owner."
      />

      <Typography variant="h2" component="h2" sx={{ mb: 2 }}>
        Your engineers
      </Typography>

      <QueryState
        isPending={engineers.isPending}
        error={engineers.error}
        errorFallback="Could not load the engineer roster."
      >
        {(engineers.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="No engineers yet"
            description="A facility admin adds engineers on the Engineers screen."
          />
        ) : (
          <EngineerRoster engineers={engineers.data?.items ?? []} categories={categories.data} />
        )}
      </QueryState>

      <Typography variant="h2" component="h2" sx={{ mt: 5, mb: 2 }}>
        Waiting for an owner
      </Typography>

      <QueryState
        isPending={unassigned.isPending}
        error={unassigned.error}
        errorFallback="Could not load the unassigned tickets."
      >
        {(unassigned.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="Everything is picked up"
            description="No open ticket is waiting for an owner."
          />
        ) : (
          <Box
            sx={{
              display: 'grid',
              gap: 1.5,
              // Three columns on a desktop, one on a phone. This is a queue to
              // triage rather than a list to read: twenty-five full-width rows
              // is most of a 1440px screen spent on one ticket at a time, and
              // a lead deciding who gets what wants as many of them in view at
              // once as will still fit a title.
              //
              // `auto-fit` against a minimum rather than a breakpoint, for the
              // reason D44 records: this grid sits inside the shell's content
              // box, which is 248px of drawer and the page padding narrower
              // than the window, so a rule written against the window's width
              // would be wrong by that much. At the 300px floor it is three
              // columns on a desktop, two on a tablet and one on a phone,
              // which is the same answer arrived at honestly.
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              alignItems: 'start',
            }}
          >
            {/*
              §5.7: the same row the engineer home screen draws, with Assign
              in place of Pick up. It used to be a card of its own with its
              own typography, its own link treatment and its own idea of where
              the chips go — three copies of a decision that only ever needed
              one answer. The button is the whole of the real difference
              between the two screens.

              It brings the stretched link with it, so the card opens the
              ticket from anywhere on it while Assign stays a button.
            */}
            {(unassigned.data?.items ?? []).map((incident) => (
              <HomeTicketRow
                key={incident.id}
                incident={incident}
                detail={`${incident.category.group_name} › ${incident.category.name} · reported ${relativeTime(incident.created_at)}`}
                actions={
                  <AssignButton
                    incidentId={incident.id}
                    reference={incident.reference}
                    groupId={incident.category.group_id}
                    currentAssigneeId={incident.assignee?.id ?? null}
                  />
                }
              />
            ))}
          </Box>
        )}
      </QueryState>
    </Box>
  );
}
