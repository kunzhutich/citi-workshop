import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * A whole `<table>` row that opens what it describes.
 *
 * **A click handler, and deliberately not the stretched link the cards use**
 * (`components/stretchedLink.ts`). An overlay inside a `<td>` would have to
 * escape the cell to cover the row, and a `<tr>` is not a reliable positioning
 * context to hang one off; worse, it would block selecting the text of a
 * table, which is a thing people do to tables and do not do to cards. Cards
 * and flex rows take the overlay, tables take this, and the two are not
 * interchangeable — D55 and D58 §5.5 are where each was settled.
 *
 * So the row is a *convenience* and **the row's own reference stays a real
 * link**. That link is what keeps the row reachable by keyboard and announced
 * as a link by a screen reader; a `<tr onClick>` is neither, and a row that is
 * only clickable with a mouse would be a regression dressed as a feature.
 *
 * ```tsx
 * const openRow = useRowNavigation();
 * …
 * <TableRow hover sx={{ cursor: 'pointer' }}
 *           onClick={(event) => openRow(event, engineerPath(engineer.user_id))}>
 * ```
 *
 * **A hook rather than a bare `shouldIgnoreRowClick` predicate.** What is
 * being kept in one place is not only which clicks to decline but that a row
 * click navigates at all; handing out the exceptions and leaving the action at
 * each call site would be half of one decision in three files, free to drift
 * from the other half. Three tables want this now — tickets, the engineer
 * roster and the dashboard's workload table — which is why it stopped living
 * in the first one that needed it.
 */

/** What a row click must not steal, because these handle their own. */
const INTERACTIVE_SELECTOR = 'a, button, input, [role="button"]';

export interface RowNavigationOptions {
  /**
   * React Router navigation state to carry.
   *
   * The ticket tables pass `useTicketLinkState()`, so the detail page can name
   * the list the reader came from. Most tables have nothing to say here.
   */
  state?: unknown;
}

/** Open `to`, unless this click belongs to something inside the row. */
export type OpenRow = (
  event: MouseEvent<HTMLElement>,
  to: string,
  options?: RowNavigationOptions,
) => void;

/**
 * Build the `onClick` a clickable table row takes.
 *
 * Three clicks are declined, each for its own reason: one already handled,
 * which a nested control has claimed; one that landed on something else
 * interactive, because the reference link navigates by itself and a button in
 * a cell must not be swallowed by the row underneath it; and one that ends a
 * drag across text, because navigating out from under a selection would make a
 * table impossible to read from.
 *
 * The first two overlap on an anchor and nowhere else: React Router's `Link`
 * calls `preventDefault` before it navigates, so a link is held by either
 * guard on its own, while a `<button>` prevents nothing and is held only by
 * the second. Measured by deleting each in turn, and worth knowing before one
 * of them is removed as redundant — it is not.
 */
export function useRowNavigation(): OpenRow {
  const navigate = useNavigate();

  return (event, to, options = {}) => {
    if (event.defaultPrevented) {
      return;
    }
    if (event.target instanceof Element && event.target.closest(INTERACTIVE_SELECTOR)) {
      return;
    }
    if ((window.getSelection()?.toString().length ?? 0) > 0) {
      return;
    }
    void navigate(to, { state: options.state });
  };
}
