import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

/**
 * A ticket's title, at the one treatment its surface calls for.
 *
 * §4.6 of the redesign brief: *"Black in some places, blue in others; sizes
 * vary. Pick one treatment per context and apply it. The detail page may
 * legitimately differ — decide deliberately and write down the rule."* This is
 * the rule.
 *
 * Six places rendered a ticket title and no two agreed: `body2` in the table,
 * `subtitle1` at weight 600 on a card, `body1` on the home rows, `subtitle2`
 * on the team page — and that last one sat *inside* the link with the ticket
 * reference, so it wore the link colour while every other title was ink. That
 * is the "blue in some places" half, and it is the half that actually misleads:
 * a coloured title says "this is the thing to click" on a card where the whole
 * card is already the target.
 *
 * ## The rule
 *
 * **A title is always ink, never a link colour.** What is clickable is the
 * reference, or the row, and colour is how a reader tells those apart.
 *
 * **Its size follows how much of the screen the ticket owns**, which is the one
 * thing that genuinely differs between these surfaces:
 *
 * | density | where | treatment |
 * | ------- | ----- | --------- |
 * | `row`   | table rows, dashboard panel rows | `body2`, regular weight |
 * | `card`  | the phone's card list, home rows, the team page | `subtitle1`, weight 600 |
 * | `page`  | the ticket detail page | `h1` |
 *
 * `page` is the deliberate exception the brief allows. There the title is not
 * one item among many — it is what the page is *about*, and the heading level
 * is a fact for a screen reader as much as a size for everyone else.
 */
export type TitleDensity = 'row' | 'card' | 'page';

export interface TicketTitleProps {
  density: TitleDensity;
  children: ReactNode;
  /**
   * Clip to one line rather than wrapping.
   *
   * For a table cell, where a wrapped title makes one row twice the height of
   * its neighbours. The caller supplies the `title` attribute for the full text
   * — this component does not, because it takes a node and not a string.
   */
  noWrap?: boolean;
  /** The full text, for a tooltip when `noWrap` clips it. */
  title?: string;
}

export function TicketTitle({ density, children, noWrap = false, title }: TicketTitleProps) {
  if (density === 'page') {
    return (
      <Typography variant="h1" component="h1" sx={{ overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    );
  }

  return (
    <Typography
      variant={density === 'card' ? 'subtitle1' : 'body2'}
      noWrap={noWrap}
      title={title}
      // Stated rather than inherited. These titles sit inside links often
      // enough that inheriting is how the team page came to have a brown one.
      sx={{ color: 'text.primary', fontWeight: density === 'card' ? 600 : 400 }}
    >
      {children}
    </Typography>
  );
}
