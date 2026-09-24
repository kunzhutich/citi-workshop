import type { SxProps, Theme } from '@mui/material/styles';

/**
 * Making a whole card clickable when the card also carries buttons.
 *
 * The obvious approach — wrap everything in a `CardActionArea` — is what
 * `IncidentCardList` does, and it is only available to a card with no other
 * controls in it. A `<button>` inside an `<a>` is invalid HTML and browsers
 * resolve it by folding the button into the link, so "Pick up" would navigate
 * to the ticket instead of picking it up. That constraint is why the home
 * screens' rows had only their title clickable.
 *
 * The way round it is a **stretched link**: exactly one real `<a>` in the
 * card — the title — grown by an absolutely positioned `::after` that covers
 * the card, and the buttons lifted above that overlay on the z axis. The
 * markup stays valid, there is still one link and one tab stop for it, and a
 * screen reader still hears the title as the link's name rather than the whole
 * card's text read out.
 *
 * ## The three pieces, and all three are required
 *
 * ```tsx
 * <Card sx={clickableCard}>
 *   <CardContent>
 *     <TicketTitle density="card">
 *       <Link component={RouterLink} to={…} sx={stretchedLink}>{title}</Link>
 *     </TicketTitle>
 *     …
 *     <RowActions sx={aboveStretchedLink}>{actions}</RowActions>
 *   </CardContent>
 * </Card>
 * ```
 *
 * Miss `clickableCard` and the overlay escapes to the nearest positioned
 * ancestor, covering far more than intended. Miss `aboveStretchedLink` and the
 * buttons stop working — which is the failure this whole arrangement exists to
 * avoid, so it is worth a test rather than a comment.
 *
 * **What it costs.** Text inside the card can no longer be selected by
 * dragging across it, because the overlay is what the pointer meets. That is
 * the accepted trade of this pattern everywhere it is used; a ticket card is
 * something you click rather than something you quote.
 *
 * ## Why all three are `satisfies SxProps<Theme>` rather than annotated
 *
 * They used to be `const x: SxProps<Theme> = {…}`, which is checked just as
 * well and types each one as the whole union — object *or* function *or*
 * array. That is fine while a caller writes `sx={stretchedLink}` and nothing
 * else, which was every caller until R7. The moment one needs to combine a
 * fragment with a style of its own, `sx={[{ fontWeight: 600 }, stretchedLink]}`
 * stops compiling: an element of the array form may not itself be an array,
 * and the annotation says it might be. `satisfies` checks the same thing and
 * keeps the literal type, so a fragment composes.
 */

/** On the `Card`: gives the overlay something to be measured against. */
export const clickableCard = {
  position: 'relative',
  // The whole card is a target now, so it should say so before it is clicked.
  '&:hover': { borderColor: 'text.disabled' },
  '&:has(a:hover) .MuiTypography-root, &:has(a:focus-visible) .MuiTypography-root': {
    textDecoration: 'none',
  },
} satisfies SxProps<Theme>;

/** On the one `<a>` that should grow to the card's size. */
export const stretchedLink = {
  '&::after': {
    content: '""',
    position: 'absolute',
    inset: 0,
    // Above the card's own background, below anything given
    // `aboveStretchedLink`.
    zIndex: 0,
    borderRadius: 'inherit',
  },
} satisfies SxProps<Theme>;

/** On anything that must stay clickable through the overlay. */
export const aboveStretchedLink = {
  position: 'relative',
  zIndex: 1,
} satisfies SxProps<Theme>;
