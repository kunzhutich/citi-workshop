import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';

import type { IncidentListItem } from '../../api/types';
import { EscalatedFlag } from '../../components/EscalatedFlag';
import { PriorityChip } from '../../components/PriorityChip';
import { StatusChip } from '../../components/StatusChip';
import { relativeTime } from '../../display/time';
import { incidentPath } from '../../routes';

export interface IncidentCardListProps {
  incidents: IncidentListItem[];
}

/**
 * The same tickets as `IncidentTable`, as cards, for a phone.
 *
 * A table at 375px is either eight unreadable columns or a horizontal scroll
 * that hides half of them. A card can drop the columns that are only useful
 * for comparison — category, assignee — and keep the four that identify a
 * ticket, at a size a thumb can hit.
 *
 * The whole card is the link, not a small reference in its corner: 44px of
 * target is the difference between tapping a ticket and tapping the one below
 * it.
 */
export function IncidentCardList({ incidents }: IncidentCardListProps) {
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      {incidents.map((incident) => (
        <Card key={incident.id}>
          <CardActionArea component={RouterLink} to={incidentPath(incident.id)}>
            <CardContent>
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: 1,
                }}
              >
                <Typography variant="overline" color="text.secondary">
                  {incident.reference}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {relativeTime(incident.updated_at)}
                </Typography>
              </Box>

              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                {incident.title}
              </Typography>

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
                <StatusChip status={incident.status} />
                <PriorityChip priority={incident.priority} />
                {incident.is_escalated ? <EscalatedFlag /> : null}
              </Box>

              <Typography variant="caption" color="text.secondary">
                {incident.location.path}
              </Typography>
            </CardContent>
          </CardActionArea>
        </Card>
      ))}
    </Box>
  );
}
