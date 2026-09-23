import type { AllowedTransition, Incident } from '../../api/types';

/**
 * Whether a viewer has anything to do on a ticket.
 *
 * Its own module, and not part of `IncidentActions.tsx`, for the reason
 * `categoryIcons.ts` is separate from `CategoryIcon.tsx`: a module that
 * exports both a component and a plain function loses Vite's Fast Refresh.
 *
 * Three things read these: the desktop card decides whether to say "there is
 * nothing for you to do", the phone's sticky bar decides whether to render at
 * all, and the detail page decides whether to reserve the height that bar
 * would occupy. The last one matters — an engineer looking at a colleague's
 * in-progress ticket has no actions, and a strip of empty space above the
 * navigation reads as something that failed to load.
 */

/** Whether any of the `can_*` flags offer something. */
export function hasContextualActions(incident: Incident): boolean {
  return (
    incident.can_assign ||
    incident.can_escalate ||
    incident.can_clear_escalation ||
    incident.can_change_priority ||
    incident.can_edit
  );
}

/** Whether there are workflow moves or contextual actions, or neither. */
export function hasAnyAction(incident: Incident, transitions: AllowedTransition[]): boolean {
  return transitions.length > 0 || hasContextualActions(incident);
}
