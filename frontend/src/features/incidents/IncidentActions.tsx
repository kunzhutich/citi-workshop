import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';

import type { AllowedTransition, CurrentUser, Incident } from '../../api/types';
import { transitionButtonColor } from '../../display/statusColor';
import { hasAnyAction, hasContextualActions } from './actionAvailability';

/**
 * Everything a user may do to a ticket, and nothing else.
 *
 * Two sources, and neither of them is a rule written here:
 *
 * * the **workflow buttons** come from `allowed-transitions`, one button per
 *   entry, labelled with its `action_label`. Adding a transition to
 *   `app/workflow.py` puts a button here with no frontend change at all;
 * * the **contextual actions** come from the ticket's `can_*` flags.
 *
 * They are two components because they are two kinds of thing — one changes
 * what the ticket *is*, the other changes what it says — and because the two
 * surfaces that render them space them differently: the desktop card puts a
 * divider between the groups, and the phone's sticky bar runs them together
 * in one scrolling row.
 */

export interface IncidentActionsProps {
  incident: Incident;
  transitions: AllowedTransition[];
  user: CurrentUser;
  onTransition: (transition: AllowedTransition) => void;
  onAssign: () => void;
  onPickUp: () => void;
  onEscalate: () => void;
  onClearEscalation: () => void;
  onChangePriority: () => void;
  onEdit: () => void;
  isPickingUp: boolean;
}

/** The workflow moves, straight from `allowed-transitions`. */
export function WorkflowButtons({ transitions, onTransition }: IncidentActionsProps) {
  return (
    <>
      {transitions.map((transition) => (
        <Button
          key={`${transition.to_status}-${transition.action_label}`}
          variant="contained"
          // Green for Resolve and orange for Mark blocked, because those two
          // destinations mean the same thing to everyone. Everything else is
          // plain — see `transitionButtonColor` for why CLOSED is not grey.
          color={transitionButtonColor(transition.to_status)}
          onClick={() => onTransition(transition)}
        >
          {transition.action_label}
        </Button>
      ))}
    </>
  );
}

/**
 * Everything that is not a status change, from the `can_*` flags.
 *
 * The one place this reads anything else is "Pick up", which is shown when the
 * caller is an engineer and the ticket has no assignee. That is not a second
 * permission check — `can_assign` is still the gate, and it is already false
 * for a JUNIOR — it only chooses between two spellings of the same right:
 * taking the ticket yourself, or opening the dialog to choose someone.
 *
 * A SENIOR engineer may open that dialog and will be refused by the API if
 * they choose anybody but themselves. That refusal is left to the API on
 * purpose: re-deriving "only a LEAD may assign others" here would be the UI
 * keeping its own copy of a rule that lives in `services/assignment.py`.
 */
export function ContextualButtons(props: IncidentActionsProps) {
  const { incident, user, isPickingUp } = props;
  const canPickUp = incident.can_assign && user.role === 'ENGINEER' && !incident.assignee;

  return (
    <>
      {canPickUp ? (
        <Button variant="outlined" onClick={props.onPickUp} loading={isPickingUp}>
          Pick up
        </Button>
      ) : null}
      {incident.can_assign ? (
        <Button variant="outlined" onClick={props.onAssign}>
          {incident.assignee ? 'Reassign…' : 'Assign…'}
        </Button>
      ) : null}
      {incident.can_escalate ? (
        <Button variant="outlined" color="error" onClick={props.onEscalate}>
          Escalate
        </Button>
      ) : null}
      {incident.can_clear_escalation ? (
        <Button variant="outlined" color="warning" onClick={props.onClearEscalation}>
          Clear escalation
        </Button>
      ) : null}
      {incident.can_change_priority ? (
        <Button variant="outlined" onClick={props.onChangePriority}>
          Change priority
        </Button>
      ) : null}
      {incident.can_edit ? (
        <Button variant="outlined" onClick={props.onEdit}>
          Edit
        </Button>
      ) : null}
    </>
  );
}

/** The desktop right column: both groups, stacked, with a rule between them. */
export function ActionsCard(props: IncidentActionsProps) {
  const { incident, transitions } = props;
  const hasWorkflow = transitions.length > 0;
  const hasContextual = hasContextualActions(incident);

  return (
    <Card>
      <CardContent>
        <Typography variant="h3" gutterBottom>
          Actions
        </Typography>

        {hasWorkflow || hasContextual ? (
          <>
            {hasWorkflow ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <WorkflowButtons {...props} />
              </Box>
            ) : null}

            {hasWorkflow && hasContextual ? <Divider sx={{ my: 2 }} /> : null}

            {hasContextual ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <ContextualButtons {...props} />
              </Box>
            ) : null}
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            There is nothing for you to do on this ticket.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The phone's sticky bar: both groups in one horizontally scrolling row.
 *
 * No card, no heading and no divider. At 375px the actions have to be within
 * a thumb's reach at all times — a reporter should not have to scroll past
 * the whole activity timeline to find "Confirm fixed" — and a heading in a
 * 56px bar is 24px of the screen spent saying what the buttons already say.
 */
export function ActionsBar(props: IncidentActionsProps) {
  const { incident, transitions } = props;

  if (!hasAnyAction(incident, transitions)) {
    return null;
  }

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1,
        overflowX: 'auto',
        // Buttons keep their width instead of being squeezed by the row.
        '& > .MuiButton-root': { flexShrink: 0 },
      }}
    >
      <WorkflowButtons {...props} />
      <ContextualButtons {...props} />
    </Box>
  );
}
