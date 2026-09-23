import { type ChipProps } from '@mui/material/Chip';

import type { IncidentStatus } from '../api/types';
import { statusLabel } from '../display/labels';
import { statusChipColor } from '../display/statusColor';
import { UniformChip } from './UniformChip';

/**
 * A ticket's status, coloured the same way everywhere it appears.
 *
 * Colour is a second channel carrying the same information as the text, so a
 * dense list can be scanned without reading every row. The palette lives in
 * `display/statusColor.ts` because the workflow buttons read it too — a button
 * that moves a ticket to Resolved is the green of the Resolved chip.
 *
 * Every status chip is the same width, whatever the word. See `UniformChip`.
 */
export interface StatusChipProps {
  status: IncidentStatus;
  size?: ChipProps['size'];
}

export function StatusChip({ status, size = 'small' }: StatusChipProps) {
  return (
    <UniformChip
      family="status"
      label={statusLabel(status)}
      color={statusChipColor(status)}
      size={size}
      variant="filled"
    />
  );
}
