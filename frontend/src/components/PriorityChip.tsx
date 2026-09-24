import { type ChipProps } from '@mui/material/Chip';

import type { IncidentPriority } from '../api/types';
import { priorityLabel } from '../display/labels';
import { UniformChip } from './UniformChip';

/**
 * A ticket's priority.
 *
 * **The arrows are gone, and that is safe.** They were added on the reasoning
 * that "colour alone fails for the roughly one person in twelve with a
 * red-green deficiency" — which is true of colour alone, and this chip has
 * never been colour alone. It carries the word *Critical*. WCAG 1.4.1 is about
 * colour being the *only* visual means of conveying information, and the label
 * has always been the other one. The icons were a third channel behind a
 * second, and four of them in a table column made every row noisier than the
 * rows helped.
 *
 * **CRITICAL is filled where the other three are outlined.** That is the real
 * answer to the problem the arrows were reaching for: the row people most need
 * to find is now the only one with a solid block of colour in it, which is a
 * difference in *form* rather than in hue, and survives both a red-green
 * deficiency and a black-and-white printout. The outlined three stay outlined
 * so that a list of ordinary tickets does not turn into a wall of blocks.
 *
 * Every priority chip is the same width, whatever the word. See `UniformChip`.
 */
const PRIORITY_COLORS: Record<IncidentPriority, ChipProps['color']> = {
  LOW: 'default',
  MEDIUM: 'info',
  HIGH: 'warning',
  CRITICAL: 'error',
};

export interface PriorityChipProps {
  priority: IncidentPriority;
  size?: ChipProps['size'];
}

export function PriorityChip({ priority, size = 'small' }: PriorityChipProps) {
  return (
    <UniformChip
      family="priority"
      label={priorityLabel(priority)}
      color={PRIORITY_COLORS[priority]}
      size={size}
      variant={priority === 'CRITICAL' ? 'filled' : 'outlined'}
    />
  );
}
