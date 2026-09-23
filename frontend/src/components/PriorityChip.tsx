import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import DragHandleIcon from '@mui/icons-material/DragHandle';
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';
import Chip, { type ChipProps } from '@mui/material/Chip';
import type { ReactElement } from 'react';

import type { IncidentPriority } from '../api/types';
import { priorityLabel } from '../display/labels';

/**
 * A ticket's priority, with an icon as well as a colour.
 *
 * The icon is not decoration. Colour alone fails for the roughly one person in
 * twelve with a red-green deficiency, and "critical" is exactly the row they
 * most need to find — so the arrow carries the same message independently.
 */
const PRIORITY_COLORS: Record<IncidentPriority, ChipProps['color']> = {
  LOW: 'default',
  MEDIUM: 'info',
  HIGH: 'warning',
  CRITICAL: 'error',
};

const PRIORITY_ICONS: Record<IncidentPriority, ReactElement> = {
  LOW: <ArrowDownwardIcon />,
  MEDIUM: <DragHandleIcon />,
  HIGH: <ArrowUpwardIcon />,
  CRITICAL: <PriorityHighIcon />,
};

export interface PriorityChipProps {
  priority: IncidentPriority;
  size?: ChipProps['size'];
}

export function PriorityChip({ priority, size = 'small' }: PriorityChipProps) {
  return (
    <Chip
      label={priorityLabel(priority)}
      color={PRIORITY_COLORS[priority]}
      icon={PRIORITY_ICONS[priority]}
      size={size}
      variant="outlined"
    />
  );
}
