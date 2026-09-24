import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';

import { describeError } from '../../api/errors';
import type { AssignResult, Engineer } from '../../api/types';
import { QueryState } from '../../components/QueryState';
import { ResponsiveDialog } from '../../components/ResponsiveDialog';
import { LevelChip } from '../../components/LevelChip';
import { useCategoryTree } from '../categories/hooks';
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

  /*
   * Specialty ids to names, for the chips on each row.
   *
   * An engineer carries `specialty_group_ids`; the names live on the category
   * tree, which every screen already has cached. The dialog reads it rather
   * than the API growing a denormalised name, which would be a second copy of
   * a thing that changes when an admin renames a group.
   */
  const categories = useCategoryTree();
  const groupNames = useMemo(
    () => new Map((categories.data?.groups ?? []).map((group) => [group.id, group.name] as const)),
    [categories.data],
  );

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
                ticketGroupId={groupId}
                groupNames={groupNames}
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
  /** The ticket's category group — the one a specialty chip turns green for. */
  ticketGroupId: string | null;
  groupNames: Map<string, string>;
  isCurrent: boolean;
  disabled: boolean;
  onSelect: () => void;
}

/**
 * One engineer, as §5.3 asks for them.
 *
 * **Line one is who they are and whether they are free; line two is what they
 * know.** Those are the two questions an assigner is holding at once, and the
 * point of separating them is the compromise: when the specialist is busy,
 * somebody has to be picked anyway, and the row that makes qualification and
 * availability equally visible is the row that makes that choice an informed
 * one rather than a guess.
 *
 * The specialty chips are all present, and the ones matching the ticket's
 * category group are green. That is a deliberate change from the single
 * "Specialty" badge this used to carry: a badge says *whether* somebody
 * matches, and the chips say *what they know* — so "no green chips, but they
 * do networks and this is a network-adjacent problem" is a judgement the
 * assigner can now make.
 */
function EngineerRow({
  engineer,
  ticketGroupId,
  groupNames,
  isCurrent,
  disabled,
  onSelect,
}: EngineerRowProps) {
  return (
    // The `ListItem` wrapper is what keeps the `<ul>` legal: a `ListItemButton`
    // renders a `<button>`, which is not an allowed direct child of a list.
    <ListItem disablePadding sx={{ display: 'block' }}>
      <ListItemButton
        onClick={onSelect}
        disabled={disabled || isCurrent}
        selected={isCurrent}
        sx={{ borderRadius: 1, mb: 0.5, alignItems: 'flex-start', gap: 2 }}
      >
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          {/* Line 1: name · level · — · availability. */}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
            <Typography variant="subtitle2">{engineer.full_name}</Typography>
            <LevelChip level={engineer.level} />
            <Typography component="span" variant="caption" color="text.secondary">
              —
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {availabilityLabel(engineer.availability)}
            </Typography>
            {isCurrent ? <Chip size="small" color="primary" label="Assigned" /> : null}
          </Box>

          {/* Line 2: everything they cover, with this ticket's group green. */}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.75 }}>
            {engineer.specialty_group_ids.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                No specialties set — can take anything
              </Typography>
            ) : (
              engineer.specialty_group_ids.map((id) => {
                const matches = id === ticketGroupId;
                return (
                  <Chip
                    key={id}
                    size="small"
                    // Filled, both of them — grey for what they cover, green
                    // for the one this ticket needs. The non-matching chips
                    // were outlined at first, which made them look exactly
                    // like the outlined level chip two inches to the left:
                    // one row, two kinds of fact, one appearance. Filled grey
                    // is also what the engineer roster already draws these in.
                    color={matches ? 'success' : 'default'}
                    label={groupNames.get(id) ?? 'Unknown group'}
                    // Green is not the only channel. The grey is a pale fill
                    // with dark text and the green is a dark fill with white
                    // text, so the pair differs in lightness as well as hue —
                    // which is what survives a red-green deficiency — and the
                    // title says it in words as well.
                    title={matches ? "This ticket's category" : undefined}
                  />
                );
              })
            )}
          </Box>
        </Box>
        <CapacityBar active={engineer.active_ticket_count} max={engineer.max_active_tickets} />
      </ListItemButton>
    </ListItem>
  );
}
