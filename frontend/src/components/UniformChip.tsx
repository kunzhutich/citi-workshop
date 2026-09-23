import Chip from '@mui/material/Chip';
import { styled } from '@mui/material/styles';

/**
 * A chip that is the same size as every other chip of its kind.
 *
 * Three families of chip in this application say one value out of a small
 * fixed set — a ticket's status, its priority, an engineer's level — and until
 * now each one was as wide as its own word. "Open" beside "In progress" is a
 * 47px chip beside an 81px one, and in a table column that difference reads as
 * a meaningful distinction rather than as the length of an English word. The
 * redesign brief asks for one width per family, and this is the one place that
 * decides it.
 *
 * `styled()` rather than an `sx` prop repeated at each use, and rather than a
 * `MuiChip` override in `theme.ts`: the rule applies to three components and
 * not to every chip in the application. Specialty chips, the "New" badge in
 * the inbox and the escalation flag all say something whose length is real
 * information, and they keep their natural width.
 *
 * **The widths are measured, not guessed.** Each is the family's longest
 * rendered label plus the padding below, taken from a real browser at the
 * theme's own font and rounded up to the next multiple of four. They are
 * asserted in `e2e/chips.spec.ts`, because a font change moves them and
 * nothing else would notice.
 */

/**
 * Horizontal padding inside the label, in pixels.
 *
 * Material UI's small chip uses 8. The brief calls the chips tight, and at 8px
 * a filled chip's word touches the colour's edge closely enough that the chip
 * reads as a label with a background rather than as a token.
 */
const LABEL_PADDING = 12;

/**
 * The pinned width of each family, in pixels.
 *
 * Each family's longest chip as it renders at 13px Roboto with the padding
 * above, rounded up to the next multiple of four:
 *
 * | family   | longest       | measured | pinned |
 * | -------- | ------------- | -------- | ------ |
 * | status   | In progress   | 88.8     | 92     |
 * | priority | Medium        | 73.3     | 76     |
 * | level    | Senior        | 62.8     | 64     |
 *
 * Taken by rendering the real screens with these widths set to zero and
 * reading the boxes back, not by counting characters. Priority is measured
 * **without** the arrows the brief removes; with them "Medium" was 79.3 and a
 * one-word chip would have been the widest thing in the row.
 */
export const CHIP_WIDTH = {
  status: 92,
  priority: 76,
  level: 64,
} as const;

export type ChipFamily = keyof typeof CHIP_WIDTH;

/**
 * The base every uniform chip is built from.
 *
 * `family` is transient — it picks a width and must not reach the DOM, where
 * React would warn about an unknown attribute on a `<div>`.
 */
export const UniformChip = styled(Chip, {
  shouldForwardProp: (prop) => prop !== 'family',
})<{ family: ChipFamily }>(({ family }) => ({
  minWidth: CHIP_WIDTH[family],
  // `minWidth` alone would leave a short word sitting at the left edge of a
  // wide chip. The label is what has to be centred, not the box.
  justifyContent: 'center',
  '& .MuiChip-label': {
    paddingLeft: LABEL_PADDING,
    paddingRight: LABEL_PADDING,
  },
}));
