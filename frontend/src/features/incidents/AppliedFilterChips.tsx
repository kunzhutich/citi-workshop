import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';

import { useAuth } from '../../auth/AuthContext';
import { useCategoryTree } from '../categories/hooks';
import { useEngineers } from '../engineers/hooks';
import type { IncidentFilterControls } from './useIncidentFilters';

/**
 * The filters this reader has no control for, shown as removable chips.
 *
 * M7's dashboard links every KPI tile and every chart segment into this list,
 * carrying filters the bar above did not offer. Without this strip the reader
 * would see a list that does not match the screen's title, with nothing on the
 * page explaining why and no way to widen it. A filter that is applied but
 * invisible is worse than one that is missing.
 *
 * **A chip only for a filter with no control, and never beside a control
 * showing the same value.** That is the whole rule, and it is why this
 * component is told what the bar drew instead of deciding for itself. R7 moved
 * two of the original three across that line: the reported-between range now
 * has a control for everybody, so its chip is gone, and the engineer has one
 * for facility admins and LEAD engineers, so its chip survives for exactly the
 * readers who have no other way to see or remove it — the employee who
 * followed a dashboard link being the case that matters. A subcategory still
 * has no control anywhere, so its chip is unconditional.
 *
 * Each chip names the thing in the reader's words rather than echoing a UUID,
 * which is why this component resolves ids: a subcategory from the category
 * tree everybody can read, an assignee from the engineer roster only staff
 * can. When the name cannot be resolved — an employee following an assignee
 * link, a category that has since been deactivated — the chip still appears
 * and still removes the filter, saying what it can. Vanishing would be the one
 * unacceptable behaviour.
 */
export interface AppliedFilterChipsProps {
  controls: IncidentFilterControls;
  /**
   * Whether the bar above is drawing an engineer filter for this reader.
   *
   * A boolean rather than a session this component could interrogate itself:
   * who gets that control is the bar's rule (`mayFilterByEngineer` in
   * `IncidentFilterBar.tsx`), and a second copy of it here is how a chip and a
   * control come to disagree about one filter.
   */
  hasAssigneeControl: boolean;
}

export function AppliedFilterChips({ controls, hasAssigneeControl }: AppliedFilterChipsProps) {
  const { filters, setFilters } = controls;
  const { user } = useAuth();

  const showAssignee = Boolean(filters.assigneeId) && !hasAssigneeControl;
  // Only a chip that is being drawn needs a name, and only a named assignee
  // has one to look up. Staff only, because an employee's roster request is
  // answered with a 403 — which is also why they have no control to begin with.
  const needsName = showAssignee && filters.assigneeId !== 'unassigned';
  const engineers = useEngineers({ page_size: 100 }, needsName && user?.role !== 'EMPLOYEE');

  const categories = useCategoryTree();

  if (!filters.categoryId && !showAssignee) {
    return null;
  }

  const categoryName = categories.data?.groups
    .flatMap((group) => group.children)
    .find((child) => child.id === filters.categoryId)?.name;

  const engineerName = engineers.data?.items.find(
    (candidate) => candidate.user_id === filters.assigneeId,
  )?.full_name;

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 2 }}>
      <Typography variant="body2" color="text.secondary">
        Also filtered by:
      </Typography>

      {filters.categoryId ? (
        <Chip
          size="small"
          label={categoryName ? `Subcategory: ${categoryName}` : 'One subcategory'}
          onDelete={() => setFilters({ categoryId: '' })}
        />
      ) : null}

      {showAssignee ? (
        <Chip
          size="small"
          label={assigneeLabel(filters.assigneeId, engineerName)}
          onDelete={() => setFilters({ assigneeId: '' })}
        />
      ) : null}
    </Box>
  );
}

function assigneeLabel(assigneeId: string, engineerName: string | undefined): string {
  if (assigneeId === 'unassigned') {
    return 'Unassigned';
  }
  return engineerName ? `Assigned to ${engineerName}` : 'Assigned to one engineer';
}
