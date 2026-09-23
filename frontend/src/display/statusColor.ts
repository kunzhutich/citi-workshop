import type { ButtonProps } from '@mui/material/Button';
import type { ChipProps } from '@mui/material/Chip';

import type { IncidentStatus } from '../api/types';

/**
 * How a status is coloured, as a chip and as a button that produces it.
 *
 * The two are **not** the same mapping, and the difference is worth stating
 * because the first version of this file assumed they were.
 */

/**
 * The status palette, from BUILD-PLAN section 10.
 *
 * Colour is a second channel carrying the same information as the text, so a
 * dense list can be scanned without reading every row.
 */
export function statusChipColor(status: IncidentStatus): ChipProps['color'] {
  const colors: Record<IncidentStatus, ChipProps['color']> = {
    OPEN: 'info',
    IN_PROGRESS: 'primary',
    BLOCKED: 'warning',
    RESOLVED: 'success',
    CLOSED: 'default',
  };
  return colors[status];
}

/**
 * The colour of a workflow button, by the status it moves a ticket to.
 *
 * Only two destinations mean the same thing to everyone. **Resolve** is always
 * "I have fixed it" and **Mark blocked** is always "this has stalled", so
 * those two take the green and the orange of the states they produce — the
 * button is coloured like its outcome, which is information rather than
 * decoration.
 *
 * Everything else is plain primary, and CLOSED is the reason. A single
 * (from, to) pair carries different meanings for different actors: on a
 * resolved ticket, `RESOLVED → CLOSED` is "Confirm fixed" to the reporter and
 * "Close ticket" to the assignee, and on an open one it is "Cancel ticket".
 * The first is a happy path and the last is a discard, and the frontend cannot
 * tell them apart without keeping its own copy of `app/workflow.py` — which is
 * the thing this application refuses to do.
 *
 * So the ambiguous destination is left uncoloured rather than confidently
 * mis-coloured. Drawing "Confirm fixed" in the grey of Closed made a
 * reporter's happy path look like the least important thing on the screen.
 */
export function transitionButtonColor(toStatus: IncidentStatus): ButtonProps['color'] {
  if (toStatus === 'RESOLVED') {
    return 'success';
  }
  if (toStatus === 'BLOCKED') {
    return 'warning';
  }
  return 'primary';
}
