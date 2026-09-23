import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import { describeError } from '../../api/errors';
import type { AssignResult, Engineer } from '../../api/types';
import { QueryState } from '../../components/QueryState';
import { ResponsiveDialog } from '../../components/ResponsiveDialog';
import { levelLabel } from '../../layout/roleLabels';
import { availabilityLabel } from '../../display/labels';
import { CapacityBar } from '../engineers/CapacityBar';
import { sortForAssignment, useEngineers } from '../engineers/hooks';

/**
 * Choose who works on a ticket.
 *
 * One dialog, used by the admin's Tickets screen and by a LEAD engineer's Team
 * screen. Both are answering the same question with the same rules, and two
 * dialogs would be two places to change when the ordering or the warnings do.
 *
 * The list is ordered by specialty match then lowest load, and each row shows
 * the three facts that decide the answer: level, availability and capacity.
 *
 * **Warnings are shown, then the dialog closes on a second press.** The API
 * accepts an assignment to someone unavailable or over capacity and returns
 * `warnings` — so the dialog cannot report them *before* the fact, and
 * dismissing them silently would waste them. Showing them on the result, with
 * the assignment already made, is honest about what happened.
 */

export interface AssignDialogProps {
  open: boolean;
  onClose: () => void;
  /** The ticket's category group, which decides who is a specialty match. */
  groupId: string | null;
  currentAssigneeId: string | null;
  onAssign: (assigneeId: string | null) => Promise<AssignResult>;
  isSubmitting: boolean;
}

export function AssignDialog({
  open,
  onClose,
  groupId,
  currentAssigneeId,
  onAssign,
  isSubmitting,
}: AssignDialogProps) {
  const engineers = useEngineers({ page_size: 100 });
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const assign = async (assigneeId: string | null) => {
    setError(null);
    try {
      const result = await onAssign(assigneeId);
      if (result.warnings.length > 0) {
        setWarnings(result.warnings);
        return;
      }
      close();
    } catch (failure) {
      setError(describeError(failure, 'Could not assign this ticket.').message);
    }
  };

  const close = () => {
    setWarnings([]);
    setError(null);
    onClose();
  };

  const ordered = sortForAssignment(engineers.data?.items ?? [], groupId);

  return (
    <ResponsiveDialog open={open} onClose={close} title="Assign this ticket" maxWidth="sm">
      <DialogContent dividers>
        {warnings.length > 0 ? (
          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="subtitle2">Assigned, with a caveat:</Typography>
            {warnings.map((warning) => (
              <Typography key={warning} variant="body2">
                {warning}
              </Typography>
            ))}
          </Alert>
        ) : null}

        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}

        <QueryState
          isPending={engineers.isPending}
          error={engineers.error}
          errorFallback="Could not load the engineer roster."
        >
          <List disablePadding>
            {ordered.map((engineer) => (
              <EngineerRow
                key={engineer.user_id}
                engineer={engineer}
                isSpecialtyMatch={Boolean(groupId && engineer.specialty_group_ids.includes(groupId))}
                isCurrent={engineer.user_id === currentAssigneeId}
                disabled={isSubmitting}
                onSelect={() => void assign(engineer.user_id)}
              />
            ))}
          </List>

          {ordered.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              There are no active engineers to assign this to yet.
            </Typography>
          ) : null}
        </QueryState>
      </DialogContent>

      <DialogActions>
        {currentAssigneeId ? (
          <Button color="warning" onClick={() => void assign(null)} disabled={isSubmitting}>
            Unassign
          </Button>
        ) : null}
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={close}>{warnings.length > 0 ? 'Done' : 'Cancel'}</Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}

interface EngineerRowProps {
  engineer: Engineer;
  isSpecialtyMatch: boolean;
  isCurrent: boolean;
  disabled: boolean;
  onSelect: () => void;
}

function EngineerRow({
  engineer,
  isSpecialtyMatch,
  isCurrent,
  disabled,
  onSelect,
}: EngineerRowProps) {
  return (
    <ListItemButton
      onClick={onSelect}
      disabled={disabled || isCurrent}
      selected={isCurrent}
      sx={{ borderRadius: 1, mb: 0.5, alignItems: 'flex-start', gap: 2 }}
    >
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
          <Typography variant="subtitle2">{engineer.full_name}</Typography>
          <Chip size="small" variant="outlined" label={levelLabel(engineer.level)} />
          {isSpecialtyMatch ? <Chip size="small" color="success" label="Specialty" /> : null}
          {isCurrent ? <Chip size="small" color="primary" label="Assigned" /> : null}
        </Box>
        <Typography variant="caption" color="text.secondary">
          {availabilityLabel(engineer.availability)}
        </Typography>
      </Box>
      <CapacityBar active={engineer.active_ticket_count} max={engineer.max_active_tickets} />
    </ListItemButton>
  );
}
