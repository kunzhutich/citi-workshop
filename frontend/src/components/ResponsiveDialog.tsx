import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import type { ReactNode } from 'react';

import { useBreakpoint } from '../hooks/useBreakpoint';

export interface ResponsiveDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Widest the dialog grows on desktop. */
  maxWidth?: 'xs' | 'sm' | 'md';
}

/**
 * One dialog shape for the whole application.
 *
 * Every dialog goes through this rather than setting its own size, so no
 * screen can forget and none of them disagree.
 *
 * **It used to go full screen on a phone and no longer does.** BUILD-PLAN
 * section 10 asked for that, on the reasoning that a text field inside a
 * centred dialog is unusable once the on-screen keyboard takes half the
 * viewport. The redesign brief overrides it: a full-screen dialog looks like
 * a *page*, and a page that appeared without the address bar changing is
 * disorienting — it loses the one cue that says "this is a thing on top of
 * what you were doing, and closing it puts you back".
 *
 * The keyboard problem is real and is answered by the margins instead. A
 * phone dialog now sits inside 16px of page on every side with the content
 * behind it visible around the edges, and `maxHeight` keeps it inside the
 * viewport so the dialog scrolls rather than the page behind it.
 */
export function ResponsiveDialog({
  open,
  onClose,
  title,
  children,
  maxWidth = 'sm',
}: ResponsiveDialogProps) {
  const { isMobile } = useBreakpoint();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth={maxWidth}
      aria-labelledby="responsive-dialog-title"
      slotProps={
        isMobile
          ? {
              paper: {
                sx: {
                  // `calc(100% - 32px)` rather than a margin alone: Material
                  // UI's own phone margin is 32px all round, which at 375px
                  // leaves a dialog narrower than the keyboard it has to sit
                  // above. 16px is the page gutter the rest of the
                  // application uses, so a dialog lines up with the content
                  // behind it.
                  m: 2,
                  width: 'calc(100% - 32px)',
                  maxHeight: 'calc(100% - 32px)',
                },
              },
            }
          : undefined
      }
    >
      <DialogTitle id="responsive-dialog-title">{title}</DialogTitle>
      {children}
    </Dialog>
  );
}
