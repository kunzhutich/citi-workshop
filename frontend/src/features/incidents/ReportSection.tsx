import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import Typography from '@mui/material/Typography';
import { useRef, type ReactNode } from 'react';

import { revealScroll } from '../../display/revealScroll';
import { useBreakpoint } from '../../hooks/useBreakpoint';

export interface ReportSectionProps {
  step: number;
  question: string;
  /** Shown at the trailing edge of the heading, e.g. a "Change" link. */
  action?: ReactNode;
  children: ReactNode;
  /**
   * Whether this question has been reached yet.
   *
   * The questionnaire reveals itself as it is answered, and every section now
   * says so with this rather than by being conditionally rendered at the call
   * site. That is what lets one component own both the transition and the
   * phone's scroll instead of five copies at five call sites.
   */
  revealed?: boolean;
}

/**
 * One numbered question in the report questionnaire.
 *
 * The number is what makes a long scrolling form read as a sequence rather
 * than a wall — BUILD-PLAN section 7 asks for a single page whose sections
 * reveal progressively, precisely so a reporter can scroll back and change an
 * earlier answer, which a multi-page wizard does not allow.
 *
 * **Sections open rather than appear.** They used to be `{showX ? … : null}`,
 * so answering question 2 made question 3 exist between one frame and the
 * next — on a desktop that is a jump, and on a phone it happens below the fold
 * where there is nothing to see at all. `Collapse` gives the reveal a
 * direction, which is the difference between "something new is here" and "the
 * page changed".
 *
 * **And on a phone it scrolls to the question that just opened.** Fired from
 * `onEntered`, not from a render: a section that has not finished growing has
 * no height to scroll to, and scrolling to it lands on the empty box it is
 * about to stop being. That fault shipped once on the facilities page and is
 * described in `display/revealScroll.ts`'s neighbours.
 *
 * `onEntered` does not fire for a section that is open on first render, which
 * is exactly right: question 1 is always open and must not yank a reporter
 * down the page the moment they arrive.
 */
export function ReportSection({
  step,
  question,
  action,
  children,
  revealed = true,
}: ReportSectionProps) {
  const { isMobile } = useBreakpoint();
  const section = useRef<HTMLElement | null>(null);

  return (
    <Collapse
      in={revealed}
      unmountOnExit
      onEntered={() => {
        if (isMobile) {
          revealScroll(section.current);
        }
      }}
    >
      <Box component="section" ref={section} sx={{ mb: 5 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
            mb: 2,
          }}
        >
          <Typography variant="h2" component="h2">
            {/*
              `text.secondary`, not `text.disabled`. The number is part of the
              heading a screen reader reads out ("1. What kind of problem is
              it?") and part of what makes the form legible as a sequence — it
              is not disabled, it was only drawn as if it were. At 21.6px,
              `text.disabled` is 2.64:1 against the page; this is 5.63:1.
            */}
            <Box component="span" sx={{ color: 'text.secondary', mr: 1 }}>
              {step}.
            </Box>
            {question}
          </Typography>
          {action}
        </Box>
        {children}
      </Box>
    </Collapse>
  );
}
