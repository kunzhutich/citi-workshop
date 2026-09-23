import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';

import type { IncidentListItem } from '../../api/types';
import { EscalatedFlag } from '../../components/EscalatedFlag';
import { PriorityChip } from '../../components/PriorityChip';
import { StatusChip } from '../../components/StatusChip';
import { relativeTime } from '../../display/time';
import { incidentPath } from '../../routes';
import { useTicketLinkState } from '../incidents/backTarget';

export interface HomeTicketRowProps {
  incident: IncidentListItem;
  /** Buttons for this ticket — Pick up, Confirm fixed, Assign. */
  actions?: ReactNode;
  /** A line under the title: an escalation reason, a block reason, an age. */
  detail?: ReactNode;
}

/**
 * One ticket on a home screen, with room for its own buttons.
 *
 * Deliberately **not** `IncidentCardList`. That component makes the entire
 * card one link, which is right for a list you are browsing and wrong the
 * moment a row carries an action: a `<button>` inside an `<a>` is invalid
 * HTML, and browsers resolve it by making the button part of the link — so
 * "Confirm fixed" would navigate to the ticket instead of closing it.
 *
 * Here the reference and the title are the link and the rest of the card is
 * not, which leaves the buttons free to be buttons. The two components stay
 * separate rather than one growing a flag, because the difference is
 * structural rather than cosmetic.
 */
export function HomeTicketRow({ incident, actions, detail }: HomeTicketRowProps) {
  const ticketLinkState = useTicketLinkState();

  return (
    <Card>
      <CardContent
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 2,
          alignItems: 'flex-start',
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ minWidth: 0, flex: '1 1 260px' }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
            <Link
              component={RouterLink}
              to={incidentPath(incident.id)}
              state={ticketLinkState}
              variant="subtitle1"
              underline="hover"
              sx={{ fontWeight: 600 }}
            >
              {incident.reference}
            </Link>
            <Typography variant="caption" color="text.secondary">
              updated {relativeTime(incident.updated_at)}
            </Typography>
          </Box>

          <Typography variant="body1" sx={{ mt: 0.25 }}>
            <Link
              component={RouterLink}
              to={incidentPath(incident.id)}
              state={ticketLinkState}
              underline="hover"
              color="inherit"
            >
              {incident.title}
            </Link>
          </Typography>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
            <StatusChip status={incident.status} />
            <PriorityChip priority={incident.priority} />
            {incident.is_escalated ? <EscalatedFlag /> : null}
            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
              {incident.location.path}
            </Typography>
          </Box>

          {detail ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {detail}
            </Typography>
          ) : null}
        </Box>

        {actions ? <Box sx={{ flex: '0 0 auto' }}>{actions}</Box> : null}
      </CardContent>
    </Card>
  );
}
