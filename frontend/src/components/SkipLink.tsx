import Box from '@mui/material/Box';

export interface SkipLinkProps {
  /** The id of the element to jump to. It must be focusable — `tabIndex={-1}`. */
  targetId: string;
  children?: string;
}

/**
 * The first focusable thing on the page: a way past the navigation.
 *
 * Every screen in this application puts a report button and between three and
 * seven navigation links before its content. A keyboard or switch user meets
 * all of them on every single screen, on every navigation, before reaching the
 * thing they came for. The skip link makes that one press of Tab and one of
 * Enter instead.
 *
 * **It is hidden but never unrendered.** `display: none` and
 * `visibility: hidden` both remove an element from the focus order, which
 * would defeat the entire point. It is moved off the top of the viewport with
 * a transform and brought back on `:focus`, so it is always reachable and only
 * ever seen by someone who tabbed to it.
 *
 * The anchor's `href` is a fragment, so the browser both scrolls to the target
 * and — because the target carries `tabIndex={-1}` — moves focus into it. A
 * target without that attribute scrolls but leaves focus on the link, and the
 * next Tab lands back in the navigation the user just asked to skip. That is
 * the failure this component is most often shipped with.
 */
export function SkipLink({ targetId, children = 'Skip to main content' }: SkipLinkProps) {
  return (
    <Box
      component="a"
      href={`#${targetId}`}
      sx={(theme) => ({
        position: 'fixed',
        top: theme.spacing(1),
        left: theme.spacing(1),
        zIndex: theme.zIndex.tooltip + 1,
        px: 2,
        py: 1,
        borderRadius: 1,
        backgroundColor: theme.palette.background.paper,
        color: theme.palette.primary.main,
        border: `2px solid ${theme.palette.primary.main}`,
        fontWeight: 600,
        textDecoration: 'none',
        // Off screen until focused. Kept in the layout and in the focus order.
        transform: 'translateY(-250%)',
        transition: theme.transitions.create('transform', { duration: 150 }),
        '&:focus': { transform: 'translateY(0)' },
      })}
    >
      {children}
    </Box>
  );
}
