import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import Typography from '@mui/material/Typography';
import { visuallyHidden } from '@mui/utils';

import type { BlockedReasonType, IncidentStatus } from '../../api/types';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { blockedReasonLabel } from '../../display/labels';

/**
 * Where a ticket is in its life, as a picture.
 *
 * The required workflow visualization from BUILD-PLAN section 10. Four steps,
 * because four is what a reporter cares about: reported, someone is on it,
 * they say it is fixed, it is finished.
 *
 * **BLOCKED is not a fifth step.** It is the "In progress" step wearing an
 * error state, because that is what it is: work that has started and stalled,
 * not a stage between starting and resolving. A fifth column would imply a
 * ticket moves *through* blocked on the way to resolved, which is exactly the
 * wrong mental model — `workflow.py` only ever returns to IN_PROGRESS from it.
 *
 * Nothing here is a source of truth. It renders `incident.status`; what a user
 * may *do* about that status comes from `allowed-transitions`.
 *
 * **What a screen reader gets.** Material UI draws the three states — done,
 * here, not yet — as a tick, a filled circle and a grey circle, which is
 * colour and shape and nothing else. Each step therefore carries its state as
 * visually hidden words, and the current one carries `aria-current="step"`, so
 * the list reads "Open, done. In progress, current step. Resolved, not
 * started." rather than four bare nouns in a row. A blocked ticket says
 * "blocked" in words too: `StepLabel error` is a colour change, and red is not
 * a thing you can hear.
 */

/** The four milestones, in order. BLOCKED annotates step 2 rather than adding one. */
const STEPS: { status: IncidentStatus; label: string }[] = [
  { status: 'OPEN', label: 'Open' },
  { status: 'IN_PROGRESS', label: 'In progress' },
  { status: 'RESOLVED', label: 'Resolved' },
  { status: 'CLOSED', label: 'Closed' },
];

/** Which step a status sits on. BLOCKED shares "In progress". */
const STEP_INDEX: Record<IncidentStatus, number> = {
  OPEN: 0,
  IN_PROGRESS: 1,
  BLOCKED: 1,
  RESOLVED: 2,
  CLOSED: 3,
};

export interface WorkflowStepperProps {
  status: IncidentStatus;
  blockedReasonType?: BlockedReasonType | null;
  blockedReason?: string | null;
  reopenCount?: number;
}

export function WorkflowStepper({
  status,
  blockedReasonType,
  blockedReason,
  reopenCount = 0,
}: WorkflowStepperProps) {
  const { isMobile } = useBreakpoint();
  const activeStep = STEP_INDEX[status];
  const isBlocked = status === 'BLOCKED';

  return (
    <Box>
      <Stepper
        activeStep={activeStep}
        orientation={isMobile ? 'vertical' : 'horizontal'}
        alternativeLabel={!isMobile}
        aria-label="Ticket progress"
        /*
         * Progress is `workflow` blue, not the brand.
         *
         * Material UI draws a stepper's reached steps in `primary.main`, which
         * followed the brand to brown in the redesign. Brown is a brand; blue
         * is the convention a reader already knows for "this is how far it has
         * got". `theme.ts` keeps the two apart and this is the one instance
         * that has to say so, because Material UI has no prop for it.
         *
         * `sx` rather than a `MuiStepIcon` override in `theme.ts`: there is one
         * stepper in the application and this is a fact about it, not a global
         * rule. The error state is untouched — a blocked step stays red, and
         * red beats both of them.
         */
        sx={{
          '& .MuiStepIcon-root.Mui-active, & .MuiStepIcon-root.Mui-completed': {
            color: 'workflow.main',
          },
          '& .MuiStepIcon-root.Mui-error': { color: 'error.main' },
          '& .MuiStepConnector-root.Mui-active .MuiStepConnector-line, & .MuiStepConnector-root.Mui-completed .MuiStepConnector-line':
            { borderColor: 'workflow.main' },
        }}
      >
        {STEPS.map((step, index) => {
          const isCurrent = index === activeStep;
          const showsError = isCurrent && isBlocked;

          const isDone = index < activeStep || status === 'CLOSED';

          return (
            <Step
              key={step.status}
              completed={isDone}
              // The one step a screen reader should be able to jump to, and
              // the only non-visual signal that this is where the ticket is.
              aria-current={isCurrent ? 'step' : undefined}
            >
              <StepLabel error={showsError} optional={showsError ? blockedDetail() : undefined}>
                {showsError ? 'Blocked' : step.label}
                <Box component="span" sx={visuallyHidden}>
                  {describeStepState({ isDone, isCurrent, isBlocked: showsError })}
                </Box>
              </StepLabel>
            </Step>
          );
        })}
      </Stepper>

      {/*
        The reopen count sits outside the stepper on purpose. A reopened ticket
        has walked back through steps it had already completed, and the stepper
        shows only where it is now — without this, "In progress" on a ticket
        that has been resolved twice looks like a ticket nobody has finished.
      */}
      {reopenCount > 0 ? (
        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
          <Chip
            size="small"
            variant="outlined"
            color="warning"
            label={`Reopened ×${reopenCount}`}
          />
        </Box>
      ) : null}
    </Box>
  );

  /** The step's state, in words, for the part of the audience that cannot see it. */
  function describeStepState({
    isDone,
    isCurrent,
    isBlocked: blocked,
  }: {
    isDone: boolean;
    isCurrent: boolean;
    isBlocked: boolean;
  }): string {
    if (blocked) {
      return ', current step, blocked';
    }
    if (isCurrent) {
      return ', current step';
    }
    return isDone ? ', done' : ', not started';
  }

  /** The block reason, rendered under the errored step. */
  function blockedDetail() {
    return (
      <Typography variant="caption" color="error" component="span">
        {blockedReasonType ? blockedReasonLabel(blockedReasonType) : 'Blocked'}
        {blockedReason ? ` — ${blockedReason}` : ''}
      </Typography>
    );
  }
}
