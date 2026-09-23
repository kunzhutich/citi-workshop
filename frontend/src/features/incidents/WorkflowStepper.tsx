import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import Typography from '@mui/material/Typography';

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
      >
        {STEPS.map((step, index) => {
          const isCurrent = index === activeStep;
          const showsError = isCurrent && isBlocked;

          return (
            <Step key={step.status} completed={index < activeStep || status === 'CLOSED'}>
              <StepLabel error={showsError} optional={showsError ? blockedDetail() : undefined}>
                {showsError ? 'Blocked' : step.label}
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
