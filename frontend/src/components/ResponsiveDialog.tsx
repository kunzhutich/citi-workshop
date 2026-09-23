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
 * A dialog that becomes a full screen on a phone.
 *
 * BUILD-PLAN section 10 asks for this, and the reason is that a dialog with a
 * text field inside it is unusable at 375px any other way: the on-screen
 * keyboard takes half the viewport, and a centred, shrink-wrapped dialog ends
 * up scrolling inside a page that is also scrolling.
 *
 * Every dialog in the app goes through this rather than passing `fullScreen`
 * itself, so no screen can forget and none of them disagree about the width.
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
      fullScreen={isMobile}
      fullWidth
      maxWidth={maxWidth}
      aria-labelledby="responsive-dialog-title"
    >
      <DialogTitle id="responsive-dialog-title">{title}</DialogTitle>
      {children}
    </Dialog>
  );
}
