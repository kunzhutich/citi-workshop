import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';

import type { AllowedTransition } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { EscalatedFlag } from '../../components/EscalatedFlag';
import { PriorityChip } from '../../components/PriorityChip';
import { QueryState } from '../../components/QueryState';
import { useSnackbar } from '../../components/SnackbarContext';
import { StatusChip } from '../../components/StatusChip';
import { TicketTitle } from '../../components/TicketTitle';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { hasAnyAction } from './actionAvailability';
import { useBackTarget } from './backTarget';
import { ActionsBar, ActionsCard } from './IncidentActions';
import { ActivityTimeline } from './ActivityTimeline';
import { AssignDialog } from './AssignDialog';
import { ClearEscalationDialog } from './ClearEscalationDialog';
import { DetailsCard } from './DetailsCard';
import { EditIncidentDialog } from './EditIncidentDialog';
import { EscalateDialog } from './EscalateDialog';
import {
  useActivity,
  useAddNote,
  useAllowedTransitions,
  useAssignIncident,
  useClearEscalation,
  useEscalateIncident,
  useIncident,
  usePickUpIncident,
  useTransition,
  useUpdateIncident,
} from './hooks';
import { NoteComposer } from './NoteComposer';
import { PriorityDialog } from './PriorityDialog';
import { TransitionDialog } from './TransitionDialog';
import { WorkflowStepper } from './WorkflowStepper';

/** Which dialog, if any, is open. One at a time, by construction. */
type OpenDialog =
  | { kind: 'none' }
  | { kind: 'transition'; transition: AllowedTransition }
  | { kind: 'assign' }
  | { kind: 'escalate' }
  | { kind: 'clear-escalation' }
  | { kind: 'priority' }
  | { kind: 'edit' };

/**
 * One ticket, in full — the screen every persona shares.
 *
 * What differs between an employee, an engineer and an admin looking at the
 * same ticket is not *this* component. It is the two API answers it renders:
 * `allowed-transitions` and the `can_*` flags. A reporter sees "Confirm fixed"
 * where the assignee sees "Close ticket", because the API said so.
 *
 * Three queries rather than one — the ticket, its available moves, its
 * activity — because they change after different actions and at different
 * rates. Adding a note re-reads the timeline; it does not redraw the buttons.
 */
export function IncidentDetailPage() {
  const { incidentId = '' } = useParams();
  const { user } = useAuth();
  const backTarget = useBackTarget();
  const { isMobile } = useBreakpoint();
  const { notify } = useSnackbar();

  const incident = useIncident(incidentId);
  const transitions = useAllowedTransitions(incidentId);
  const activity = useActivity(incidentId);

  const performTransition = useTransition(incidentId);
  const assign = useAssignIncident(incidentId);
  const pickUp = usePickUpIncident();
  const escalate = useEscalateIncident(incidentId);
  const clearEscalation = useClearEscalation(incidentId);
  const changeIncident = useUpdateIncident(incidentId);
  const addNote = useAddNote(incidentId);

  const [dialog, setDialog] = useState<OpenDialog>({ kind: 'none' });
  const close = () => setDialog({ kind: 'none' });

  const ticket = incident.data;

  return (
    <Box>
      {/* Named and aimed by `backTarget.ts`, from the state the link that
          opened this ticket carried — so it goes back to the list you were
          looking at, filters and page number intact, and says which list that
          was. "All tickets" is what it falls back to for a pasted link. */}
      <Button
        component={RouterLink}
        to={backTarget.to}
        startIcon={<ArrowBackIcon />}
        sx={{ mb: 2, ml: -1 }}
      >
        {backTarget.label}
      </Button>

      <QueryState
        isPending={incident.isPending}
        error={incident.error}
        errorFallback="Could not load this ticket."
      >
        {ticket && user ? (
          <>
            <Box sx={{ mb: 3 }}>
              <Typography variant="overline" color="text.secondary">
                {ticket.reference}
              </Typography>
              <TicketTitle density="page">{ticket.title}</TicketTitle>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
                {/*
                  The one test id in the application. "In progress" appears
                  twice on this page — here, and as the current step of the
                  WorkflowStepper — so a test asking "what status is this
                  ticket?" has no unambiguous accessible query. The
                  alternative is a test that knows which of the two matches
                  come first, which is a test that breaks on a layout change.
                */}
                <Box component="span" data-testid="incident-status">
                  <StatusChip status={ticket.status} />
                </Box>
                <PriorityChip priority={ticket.priority} />
                {ticket.is_escalated ? <EscalatedFlag reason={ticket.escalation_reason} /> : null}
              </Box>
            </Box>

            <Card sx={{ mb: 3 }}>
              <CardContent>
                <WorkflowStepper
                  status={ticket.status}
                  blockedReasonType={ticket.blocked_reason_type}
                  blockedReason={ticket.blocked_reason}
                  reopenCount={ticket.reopen_count}
                />
              </CardContent>
            </Card>

            <Box
              sx={{
                display: 'grid',
                gap: 3,
                // Two columns on desktop: the story on the left, the facts and
                // the controls on the right. One column on a phone, in that
                // same order, with the actions moved to a sticky bottom bar.
                gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 2fr) minmax(280px, 1fr)' },
                alignItems: 'start',
              }}
            >
              <Box sx={{ display: 'grid', gap: 3, minWidth: 0 }}>
                <Card>
                  <CardContent>
                    <Typography variant="h3" gutterBottom>
                      What happened
                    </Typography>
                    <Typography
                      variant="body1"
                      sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                    >
                      {ticket.description}
                    </Typography>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent>
                    <Typography variant="h3" gutterBottom>
                      Activity
                    </Typography>
                    <QueryState
                      isPending={activity.isPending}
                      error={activity.error}
                      errorFallback="Could not load this ticket's history."
                    >
                      <ActivityTimeline entries={activity.data ?? []} />
                    </QueryState>

                    {ticket.can_add_note ? (
                      <>
                        <Divider sx={{ mt: 2 }} />
                        <NoteComposer
                          canWriteInternal={ticket.can_add_internal_note}
                          onSubmit={async (payload) => {
                            await addNote.mutateAsync(payload);
                            notify('Note added.');
                          }}
                          isSubmitting={addNote.isPending}
                        />
                      </>
                    ) : null}
                  </CardContent>
                </Card>
              </Box>

              <Box sx={{ display: 'grid', gap: 3, minWidth: 0 }}>
                <DetailsCard incident={ticket} />

                {/* On a phone the actions live in the sticky bar below, so the
                    card would be a duplicate of it. */}
                {!isMobile ? (
                  <QueryState
                    isPending={transitions.isPending}
                    error={transitions.error}
                    errorFallback="Could not load what you may do to this ticket."
                  >
                    <ActionsCard
                      incident={ticket}
                      transitions={transitions.data ?? []}
                      user={user}
                      onTransition={(transition) => setDialog({ kind: 'transition', transition })}
                      onAssign={() => setDialog({ kind: 'assign' })}
                      onPickUp={() => void pickUpTicket()}
                      onEscalate={() => setDialog({ kind: 'escalate' })}
                      onClearEscalation={() => setDialog({ kind: 'clear-escalation' })}
                      onChangePriority={() => setDialog({ kind: 'priority' })}
                      onEdit={() => setDialog({ kind: 'edit' })}
                      isPickingUp={pickUp.isPending}
                    />
                  </QueryState>
                ) : null}
              </Box>
            </Box>

            {isMobile && hasAnyAction(ticket, transitions.data ?? []) ? (
              <>
                {/* Reserves the height the fixed bar occupies, so the note
                    composer's last line is never underneath it — and only
                    when there is a bar, so a viewer with no actions does not
                    get a strip of empty space above the navigation. */}
                <Box sx={{ height: 96 }} />
                <Paper
                  elevation={8}
                  sx={{
                    position: 'fixed',
                    left: 0,
                    right: 0,
                    // Clear of the shell's bottom navigation, which is 56px.
                    bottom: 56,
                    zIndex: 1100,
                    p: 1.5,
                    borderRadius: 0,
                  }}
                >
                  <ActionsBar
                    incident={ticket}
                    transitions={transitions.data ?? []}
                    user={user}
                    onTransition={(transition) => setDialog({ kind: 'transition', transition })}
                    onAssign={() => setDialog({ kind: 'assign' })}
                    onPickUp={() => void pickUpTicket()}
                    onEscalate={() => setDialog({ kind: 'escalate' })}
                    onClearEscalation={() => setDialog({ kind: 'clear-escalation' })}
                    onChangePriority={() => setDialog({ kind: 'priority' })}
                    onEdit={() => setDialog({ kind: 'edit' })}
                    isPickingUp={pickUp.isPending}
                  />
                </Paper>
              </>
            ) : null}

            {dialog.kind === 'transition' ? (
              <TransitionDialog
                open
                onClose={close}
                transition={dialog.transition}
                onSubmit={async (payload) => {
                  await performTransition.mutateAsync(payload);
                  notify(`${ticket.reference}: ${dialog.transition.action_label.toLowerCase()}.`);
                }}
                isSubmitting={performTransition.isPending}
              />
            ) : null}

            {dialog.kind === 'assign' ? (
              <AssignDialog
                open
                onClose={close}
                groupId={ticket.category.group_id}
                currentAssigneeId={ticket.assignee?.id ?? null}
                onAssign={(assigneeId) => assign.mutateAsync(assigneeId)}
                isSubmitting={assign.isPending}
              />
            ) : null}

            {dialog.kind === 'escalate' ? (
              <EscalateDialog
                open
                onClose={close}
                onSubmit={async (reason) => {
                  await escalate.mutateAsync(reason);
                  notify('Escalated. A facility admin will see it.', 'warning');
                }}
                isSubmitting={escalate.isPending}
              />
            ) : null}

            {dialog.kind === 'clear-escalation' ? (
              <ClearEscalationDialog
                open
                onClose={close}
                currentPriority={ticket.priority}
                escalationReason={ticket.escalation_reason}
                onSubmit={async (payload) => {
                  await clearEscalation.mutateAsync(payload);
                  notify('Escalation cleared.');
                }}
                isSubmitting={clearEscalation.isPending}
              />
            ) : null}

            {dialog.kind === 'priority' ? (
              <PriorityDialog
                open
                onClose={close}
                currentPriority={ticket.priority}
                onSubmit={async (priority) => {
                  await changeIncident.mutateAsync({ priority });
                  notify('Priority changed.');
                }}
                isSubmitting={changeIncident.isPending}
              />
            ) : null}

            {dialog.kind === 'edit' ? (
              <EditIncidentDialog
                open
                onClose={close}
                incident={ticket}
                onSubmit={async (payload) => {
                  await changeIncident.mutateAsync(payload);
                  notify('Ticket updated.');
                }}
                isSubmitting={changeIncident.isPending}
              />
            ) : null}
          </>
        ) : null}
      </QueryState>
    </Box>
  );

  /** Take this ticket for yourself, reporting any capacity warning. */
  async function pickUpTicket() {
    const result = await pickUp.mutateAsync(incidentId);
    notify(
      result.warnings[0] ?? 'You have picked this ticket up.',
      result.warnings.length > 0 ? 'warning' : 'success',
    );
  }
}
