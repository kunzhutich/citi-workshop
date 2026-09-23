import { type ChipProps } from '@mui/material/Chip';

import type { EngineerLevel } from '../api/types';
import { levelLabel } from '../layout/roleLabels';
import { UniformChip } from './UniformChip';

/**
 * An engineer's level.
 *
 * A component rather than the bare `<Chip variant="outlined">` that used to be
 * written out at each use, for one reason: the brief asks for these to be the
 * same width as each other, and a rule repeated at two call sites is a rule
 * that holds until somebody adds a third.
 *
 * Otherwise deliberately unchanged — outlined, neutral, no colour. Level is
 * not a state and does not want a palette; what it wants is to sit in a column
 * without the rows disagreeing about where the column starts.
 */
export interface LevelChipProps {
  level: EngineerLevel;
  size?: ChipProps['size'];
}

export function LevelChip({ level, size = 'small' }: LevelChipProps) {
  return <UniformChip family="level" label={levelLabel(level)} size={size} variant="outlined" />;
}
