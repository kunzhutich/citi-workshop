import Button from '@mui/material/Button';
import { useState } from 'react';

import type { IncidentListItem } from '../../api/types';
import { useSnackbar } from '../../components/SnackbarContext';
import { AssignDialog } from './AssignDialog';
import { useAssignIncident } from './hooks';

export interface AssignButtonProps {
  incident: IncidentListItem;
  size?: 'small' | 'medium';
}

/**
 * Assign one ticket without leaving the list you found it in.
 *
 * The dialog, the mutation and the confirmation for a single row, so a screen
 * that shows tickets can offer assignment by dropping this in. The Team page
 * uses it on the unassigned queue; M7's admin dashboard will use it on the
 * "needs attention" panel.
 *
 * It is the same `AssignDialog` the detail page opens — the ordering, the
 * capacity bars and the warning handling are not reimplemented for a list.
 */
export function AssignButton({ incident, size = 'small' }: AssignButtonProps) {
  const { notify } = useSnackbar();
  const [open, setOpen] = useState(false);
  const assign = useAssignIncident(incident.id);

  return (
    <>
      <Button size={size} variant="outlined" onClick={() => setOpen(true)}>
        {incident.assignee ? 'Reassign' : 'Assign'}
      </Button>
      {open ? (
        <AssignDialog
          open
          onClose={() => setOpen(false)}
          groupId={incident.category.group_id}
          currentAssigneeId={incident.assignee?.id ?? null}
          isSubmitting={assign.isPending}
          onAssign={async (assigneeId) => {
            const result = await assign.mutateAsync(assigneeId);
            if (result.warnings.length === 0) {
              notify(
                assigneeId
                  ? `${incident.reference} assigned to ${result.incident.assignee?.full_name ?? 'them'}.`
                  : `${incident.reference} is unassigned.`,
              );
            }
            return result;
          }}
        />
      ) : null}
    </>
  );
}
