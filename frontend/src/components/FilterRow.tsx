import Box from '@mui/material/Box';
import { styled } from '@mui/material/styles';

/**
 * A row of filter controls that reflows to the width it actually has.
 *
 * Every screen that filters a list uses this: the ticket lists, the engineer
 * roster and the users page. On a phone each control ends up spanning the full
 * width, which is §4.4 of the redesign brief; on a desktop they sit side by
 * side, as many as fit.
 *
 * **No breakpoint.** `auto-fit` asks how much room this box has and divides it,
 * where a media query would ask how wide the *window* is — and these boxes live
 * inside `<main>`, which is 248px of permanent drawer and 48px of padding
 * narrower than the window. That mismatch is exactly the fault D44 was written
 * about: a six-column template switched on by `md` while the box holding it had
 * 620px, and the whole document scrolled sideways for it.
 *
 * `min(100%, …)` is the part that matters at the narrow end. Without it a
 * container narrower than one column is still overflowed by one column, which
 * is the phone case the brief is asking about.
 *
 * Controls inside should not set their own width. Material UI's theme makes
 * every `TextField` full width, which is right in a grid cell and was being
 * opted out of with `fullWidth={false}` and a `minWidth` before this existed.
 */
export interface FilterRowProps {
  /**
   * Narrowest a column may be before the row drops to fewer of them.
   *
   * The default suits two or three controls. The ticket lists pass a smaller
   * one because they have six, and at 200px six columns would need 1,300px of
   * content box — wider than a 1440px window leaves after the drawer.
   */
  minColumn?: number;
}

export const FilterRow = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'minColumn',
})<FilterRowProps>(({ theme, minColumn = 200 }) => ({
  display: 'grid',
  gap: theme.spacing(2),
  gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minColumn}px), 1fr))`,
  alignItems: 'center',
}));
