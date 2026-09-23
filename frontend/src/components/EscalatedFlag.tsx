import FlagIcon from '@mui/icons-material/Flag';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';

export interface EscalatedFlagProps {
  /** The escalation reason, shown on hover when there is one. */
  reason?: string | null;
}

/**
 * The red flag on an escalated ticket.
 *
 * Its own component rather than a third colour on `StatusChip`, because
 * escalation is orthogonal to status: a ticket can be escalated while it is
 * open, in progress or blocked, and the two facts need to be readable at once.
 */
export function EscalatedFlag({ reason }: EscalatedFlagProps) {
  const chip = <Chip label="Escalated" color="error" size="small" icon={<FlagIcon />} />;

  if (!reason) {
    return chip;
  }
  return <Tooltip title={reason}>{chip}</Tooltip>;
}
