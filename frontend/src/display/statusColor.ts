import type { ButtonProps } from '@mui/material/Button';
import type { ChipProps } from '@mui/material/Chip';

import type { IncidentStatus } from '../api/types';

/**
 * The colour each status is drawn in, from BUILD-PLAN section 10.
 *
 * In its own module because two different things read it: the chip that says
 * what a ticket's status *is*, and the workflow buttons that say what it will
 * *become*. Keeping them in step means "Resolve" is the same green as the
 * Resolved chip it produces — the button is coloured like its outcome, which
 * is information rather than decoration, and it costs no new rule because the
 * palette already existed.
 *
 * Two functions rather than one because Material UI spells neutral
 * differently for the two components: a chip wants `default` (a filled grey)
 * and a button wants `inherit` (the surrounding text colour). Only CLOSED is
 * neutral, so that is the only place they differ.
 */
const SHARED_COLORS: Record<Exclude<IncidentStatus, 'CLOSED'>, 'info' | 'primary' | 'warning' | 'success'> = {
  OPEN: 'info',
  IN_PROGRESS: 'primary',
  BLOCKED: 'warning',
  RESOLVED: 'success',
};

/** The colour of a status chip. */
export function statusChipColor(status: IncidentStatus): ChipProps['color'] {
  return status === 'CLOSED' ? 'default' : SHARED_COLORS[status];
}

/** The colour of a button that moves a ticket *into* this status. */
export function statusButtonColor(status: IncidentStatus): ButtonProps['color'] {
  return status === 'CLOSED' ? 'inherit' : SHARED_COLORS[status];
}
