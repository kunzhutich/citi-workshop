import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';

import { useAuth } from '../../auth/AuthContext';
import { formatDate } from '../../display/time';
import { useCategoryTree } from '../categories/hooks';
import { useEngineers } from '../engineers/hooks';
import type { IncidentFilterControls } from './useIncidentFilters';

/**
 * The filters that arrived by link, shown as removable chips.
 *
 * M7's dashboard links every KPI tile and every chart segment into this list,
 * and three of the filters those links carry — a subcategory, an assignee, a
 * reported-between range — have no control on the filter bar. Without this
 * strip the reader would see a list that does not match the screen's title,
 * with nothing on the page explaining why and no way to widen it. A filter
 * that is applied but invisible is worse than one that is missing.
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
}

export function AppliedFilterChips({ controls }: AppliedFilterChipsProps) {
  const { filters, setFilters } = controls;
  const { user } = useAuth();

  const hasDateRange = Boolean(filters.createdFrom || filters.createdTo);
  const hasNamedAssignee = Boolean(filters.assigneeId) && filters.assigneeId !== 'unassigned';

  const categories = useCategoryTree();
  // Only staff may read the roster, and only a named assignee needs a name.
  const engineers = useEngineers({}, hasNamedAssignee && user?.role !== 'EMPLOYEE');

  if (!filters.categoryId && !filters.assigneeId && !hasDateRange) {
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

      {filters.assigneeId ? (
        <Chip
          size="small"
          label={assigneeLabel(filters.assigneeId, engineerName)}
          onDelete={() => setFilters({ assigneeId: '' })}
        />
      ) : null}

      {hasDateRange ? (
        <Chip
          size="small"
          label={`Reported ${describeRange(filters.createdFrom, filters.createdTo)}`}
          onDelete={() => setFilters({ createdFrom: '', createdTo: '' })}
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

/** "between 25 Aug 2026 and 23 Sep 2026", or whichever end was given. */
function describeRange(from: string, to: string): string {
  if (from && to) {
    return `between ${formatDate(from)} and ${formatDate(to)}`;
  }
  if (from) {
    return `on or after ${formatDate(from)}`;
  }
  return `on or before ${formatDate(to)}`;
}
