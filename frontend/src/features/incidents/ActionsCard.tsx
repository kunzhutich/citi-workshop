import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { AllowedTransition, CurrentUser, Incident } from '../../api/types';
import { statusButtonColor } from '../../display/statusColor';

export interface ActionsCardProps {
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

/**
 * Everything this user may do to this ticket, and nothing else.
 *
 * Two sources, and neither of them is a rule written here:
 *
 * * the **workflow buttons** come from `allowed-transitions`, one button per
 *   entry, labelled with its `action_label`. Adding a transition to
 *   `app/workflow.py` puts a button here with no frontend change at all;
 * * the **remaining actions** come from the ticket's `can_*` flags.
 *
 * The one place the component reads anything else is "Pick up", which is shown
 * when the caller is an engineer and the ticket has no assignee. That is not a
 * second permission check — `can_assign` is still the gate, and it is already
 * false for a JUNIOR — it only chooses between two spellings of the same
 * right: taking the ticket yourself, or opening the dialog to choose someone.
 *
 * A SENIOR engineer may open the dialog and will be refused by the API if they
 * choose anybody but themselves. That refusal is left to the API on purpose:
 * re-deriving "only a LEAD may assign others" here would be the UI keeping its
 * own copy of a rule that lives in `services/assignment.py`.
 */
export function ActionsCard({
  incident,
  transitions,
  user,
  onTransition,
  onAssign,
  onPickUp,
  onEscalate,
  onClearEscalation,
  onChangePriority,
  onEdit,
  isPickingUp,
}: ActionsCardProps) {
  const canPickUp = incident.can_assign && user.role === 'ENGINEER' && !incident.assignee;

  const hasContextualActions =
    incident.can_assign ||
    incident.can_escalate ||
    incident.can_clear_escalation ||
    incident.can_change_priority ||
    incident.can_edit;

  if (transitions.length === 0 && !hasContextualActions) {
    return (
      <Card>
        <CardContent>
          <Typography variant="h3" gutterBottom>
            Actions
          </Typography>
          <Typography variant="body2" color="text.secondary">
            There is nothing for you to do on this ticket.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <Typography variant="h3" gutterBottom>
          Actions
        </Typography>

        <Stack spacing={1}>
          {transitions.map((transition) => (
            <Button
              key={`${transition.to_status}-${transition.action_label}`}
              variant="contained"
              // Coloured by where it leads, not by how it is worded. "Resolve"
              // is the green of the Resolved chip; "Cancel ticket" is the grey
              // of Closed, so a reporter's only available move does not read
              // as the recommended one.
              color={statusButtonColor(transition.to_status)}
              onClick={() => onTransition(transition)}
              fullWidth
            >
              {transition.action_label}
            </Button>
          ))}
        </Stack>

        {transitions.length > 0 && hasContextualActions ? <Divider sx={{ my: 2 }} /> : null}

        <Stack spacing={1}>
          {canPickUp ? (
            <Button variant="outlined" onClick={onPickUp} loading={isPickingUp} fullWidth>
              Pick up
            </Button>
          ) : null}
          {incident.can_assign ? (
            <Button variant="outlined" onClick={onAssign} fullWidth>
              {incident.assignee ? 'Reassign…' : 'Assign…'}
            </Button>
          ) : null}
          {incident.can_escalate ? (
            <Button variant="outlined" color="error" onClick={onEscalate} fullWidth>
              Escalate
            </Button>
          ) : null}
          {incident.can_clear_escalation ? (
            <Button variant="outlined" color="warning" onClick={onClearEscalation} fullWidth>
              Clear escalation
            </Button>
          ) : null}
          {incident.can_change_priority ? (
            <Button variant="outlined" onClick={onChangePriority} fullWidth>
              Change priority
            </Button>
          ) : null}
          {incident.can_edit ? (
            <Button variant="outlined" onClick={onEdit} fullWidth>
              Edit
            </Button>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}
