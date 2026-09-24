import Box from '@mui/material/Box';
import { styled } from '@mui/material/styles';

import { MOBILE_MAX_WIDTH } from '../hooks/useBreakpoint';

/**
 * The buttons that act on one row, laid out the way a phone needs them.
 *
 * On a desktop this is a plain inline row of buttons at their natural width.
 * On a phone every button inside it spans the full width and they stack, which
 * is what the redesign brief asks for in §4.5 — a 64px "Pick up" floating at
 * the right-hand end of a card is a small target in the hardest place on the
 * screen to reach.
 *
 * **The container decides, not the buttons.** The alternative was
 * `fullWidth={isMobile}` on each button, which is the same rule written at
 * four call sites and forgotten at the fifth — and it makes every button that
 * might appear in a row take a viewport prop it has no other use for.
 * `AssignButton` and the home screens' `PickUpButton` know nothing about this.
 *
 * The 900px line is `MOBILE_MAX_WIDTH + 1`, imported rather than written
 * again, so this agrees with `useBreakpoint` by construction. A container
 * query would arguably be more honest — the lesson of D44 — but "is this a
 * phone" is a viewport question everywhere else in this application, and one
 * component answering it differently from the rest would be a worse fault than
 * the one it fixed.
 */
export const RowActions = styled(Box)(({ theme }) => ({
  display: 'flex',
  gap: theme.spacing(1),
  flex: '0 0 auto',
  alignItems: 'flex-start',
  [`@media (max-width:${MOBILE_MAX_WIDTH}px)`]: {
    width: '100%',
    flexWrap: 'wrap',
    '& > *': { width: '100%' },
  },
}));
