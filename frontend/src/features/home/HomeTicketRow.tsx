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
import { RowActions } from '../../components/RowActions';
import {
  aboveStretchedLink,
  clickableCard,
  stretchedLink,
} from '../../components/stretchedLink';
import { TicketTitle } from '../../components/TicketTitle';
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
 * **The whole card opens the ticket, and the buttons still work.** Those two
 * used to be incompatible, and the note that used to be here explained why: a
 * `<button>` inside an `<a>` is invalid HTML and browsers fold the button into
 * the link, so a `CardActionArea` around everything would have made "Pick up"
 * navigate instead of picking up. The way round it is a stretched link — one
 * real anchor on the title, grown over the card by a pseudo-element, with the
 * buttons lifted above it. See `components/stretchedLink.ts`.
 *
 * It stays separate from `IncidentCardList` even so. That component has no
 * actions and can use a plain `CardActionArea`, which is simpler and needs no
 * overlay; this one earns the overlay by having buttons.
 */
export function HomeTicketRow({ incident, actions, detail }: HomeTicketRowProps) {
  const ticketLinkState = useTicketLinkState();

  return (
    <Card sx={clickableCard}>
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
            {/* Text, not a link. The card is the link now, and a second
                anchor to the same ticket would be a second tab stop and a
                second thing for a screen reader to read out for one
                destination. It keeps its weight because it is still the
                first thing anyone looks for in a row. */}
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {incident.reference}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              updated {relativeTime(incident.updated_at)}
            </Typography>
          </Box>

          {/* The flag leads the title, so it sits in one place down a list of
              cards instead of after however long this ticket's title is. */}
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mt: 0.25 }}>
            {incident.is_escalated ? <EscalatedFlag /> : null}
            <TicketTitle density="card">
              <Link
                component={RouterLink}
                to={incidentPath(incident.id)}
                state={ticketLinkState}
                underline="hover"
                color="inherit"
                sx={stretchedLink}
              >
                {incident.title}
              </Link>
            </TicketTitle>
          </Box>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
            <StatusChip status={incident.status} />
            <PriorityChip priority={incident.priority} />
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

        {actions ? <RowActions sx={aboveStretchedLink}>{actions}</RowActions> : null}
      </CardContent>
    </Card>
  );
}
