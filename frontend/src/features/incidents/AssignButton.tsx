import Button from '@mui/material/Button';
import { useState } from 'react';

import { useSnackbar } from '../../components/SnackbarContext';
import { AssignDialog } from './AssignDialog';
import { useAssignIncident } from './hooks';

export interface AssignButtonProps {
  incidentId: string;
  /** `INC-000123`, for the confirmation message. */
  reference: string;
  /** The ticket's category group, which decides who is a specialty match. */
  groupId: string | null;
  /** Who holds it now, so the dialog can mark them — null when nobody does. */
  currentAssigneeId?: string | null;
  size?: 'small' | 'medium';
}

/**
 * Assign one ticket without leaving the list you found it in.
 *
 * The dialog, the mutation and the confirmation for a single row, so any
 * screen that shows tickets can offer assignment by dropping this in. A LEAD's
 * Team screen uses it on the unassigned queue and the admin dashboard uses it
 * on both halves of the Needs attention panel.
 *
 * **It takes four fields rather than a whole ticket.** The escalated half of
 * `/reports/blocked-escalated` returns `EscalatedTicket` — a reference, a
 * title, a status and an escalation reason — and not an `IncidentListItem`,
 * because a report row is not a ticket row. Taking the ids it needs lets one
 * button serve both shapes; taking an `IncidentListItem` would have meant
 * either a second button or a fake ticket assembled to satisfy a type.
 *
 * It is the same `AssignDialog` the detail page opens — the ordering, the
 * capacity bars and the warning handling are not reimplemented for a list.
 */
export function AssignButton({
  incidentId,
  reference,
  groupId,
  currentAssigneeId = null,
  size = 'small',
}: AssignButtonProps) {
  const { notify } = useSnackbar();
  const [open, setOpen] = useState(false);
  const assign = useAssignIncident(incidentId);

  return (
    <>
      <Button size={size} variant="outlined" onClick={() => setOpen(true)}>
        {currentAssigneeId ? 'Reassign' : 'Assign'}
      </Button>
      {open ? (
        <AssignDialog
          open
          onClose={() => setOpen(false)}
          groupId={groupId}
          currentAssigneeId={currentAssigneeId}
          isSubmitting={assign.isPending}
          onAssign={async (assigneeId) => {
            const result = await assign.mutateAsync(assigneeId);
            if (result.warnings.length === 0) {
              notify(
                assigneeId
                  ? `${reference} assigned to ${result.incident.assignee?.full_name ?? 'them'}.`
                  : `${reference} is unassigned.`,
              );
            }
            return result;
          }}
        />
      ) : null}
    </>
  );
}
