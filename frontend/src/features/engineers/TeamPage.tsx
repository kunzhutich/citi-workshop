import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';

import { PageHeader } from '../../components/PageHeader';
import { EmptyState, QueryState } from '../../components/QueryState';
import { PriorityChip } from '../../components/PriorityChip';
import { StatusChip } from '../../components/StatusChip';
import { relativeTime } from '../../display/time';
import { incidentPath } from '../../routes';
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
          <Box sx={{ display: 'grid', gap: 1.5 }}>
            {(unassigned.data?.items ?? []).map((incident) => (
              <Card key={incident.id}>
                <CardContent
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 2,
                  }}
                >
                  <Box sx={{ flexGrow: 1, minWidth: 220 }}>
                    <Link
                      component={RouterLink}
                      to={incidentPath(incident.id)}
                      variant="subtitle2"
                      underline="hover"
                    >
                      {incident.reference} · {incident.title}
                    </Link>
                    <Typography variant="caption" color="text.secondary" component="p">
                      {incident.category.group_name} › {incident.category.name} ·{' '}
                      {incident.location.path} · reported {relativeTime(incident.created_at)}
                    </Typography>
                  </Box>
                  <StatusChip status={incident.status} />
                  <PriorityChip priority={incident.priority} />
                  <AssignButton incident={incident} />
                </CardContent>
              </Card>
            ))}
          </Box>
        )}
      </QueryState>
    </Box>
  );
}
