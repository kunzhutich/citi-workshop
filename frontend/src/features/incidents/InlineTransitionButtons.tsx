import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
import { useState } from 'react';

import type { AllowedTransition } from '../../api/types';
import { useSnackbar } from '../../components/SnackbarContext';
import { transitionButtonColor } from '../../display/statusColor';
import { useAllowedTransitions, useTransition } from './hooks';
import { TransitionDialog } from './TransitionDialog';

export interface InlineTransitionButtonsProps {
  incidentId: string;
  /** `INC-000123`, for the confirmation message. */
  reference: string;
  /**
   * Only draw these actions, by `action_label`.
   *
   * The employee's home screen wants Confirm fixed and Still broken and not
   * the other moves the same ticket might offer. This filters what is drawn
   * from the API's answer; it never adds to it, so a button can still only
   * appear because the API said it may.
   */
  only?: string[];
}

/**
 * The workflow buttons for one ticket, rendered in a list.
 *
 * **Still from `allowed-transitions`, and from nothing else.** BUILD-PLAN
 * section 10 asks the employee's home screen for "Confirm fixed" and "Still
 * broken" buttons beside each resolved ticket, and the tempting shortcut is to
 * render those two words whenever `status === 'RESOLVED'`. That would put a
 * copy of `app/workflow.py` in the home screen: it would keep drawing the
 * buttons after the transition table changed, it would draw them for a viewer
 * who is not the reporter, and it would draw "Still broken" past the reopen
 * window — where the API would then refuse the click. So this component asks
 * the same endpoint the detail page asks and renders the answer, `only`
 * narrowing which of the returned actions to show.
 *
 * One request per row is the cost, which is why the screens that use it show a
 * handful of rows and link to the full list for the rest.
 */
export function InlineTransitionButtons({
  incidentId,
  reference,
  only,
}: InlineTransitionButtonsProps) {
  const { notify } = useSnackbar();
  const transitions = useAllowedTransitions(incidentId);
  const perform = useTransition(incidentId);
  const [chosen, setChosen] = useState<AllowedTransition | null>(null);

  if (transitions.isPending) {
    return <Skeleton variant="rounded" width={200} height={32} />;
  }

  const available = (transitions.data ?? []).filter(
    (transition) => !only || only.includes(transition.action_label),
  );

  if (available.length === 0) {
    return null;
  }

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
      {available.map((transition) => (
        <Button
          key={`${transition.to_status}-${transition.action_label}`}
          size="small"
          variant="contained"
          color={transitionButtonColor(transition.to_status)}
          onClick={() => setChosen(transition)}
        >
          {transition.action_label}
        </Button>
      ))}

      {chosen ? (
        <TransitionDialog
          open
          onClose={() => setChosen(null)}
          transition={chosen}
          isSubmitting={perform.isPending}
          onSubmit={async (payload) => {
            const result = await perform.mutateAsync(payload);
            notify(`${reference} — ${chosen.action_label.toLowerCase()}.`);
            return result;
          }}
        />
      ) : null}
    </Box>
  );
}
