import HistoryToggleOffIcon from '@mui/icons-material/HistoryToggleOff';
import UpdateIcon from '@mui/icons-material/Update';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';

import type { ReactNode } from 'react';

import { formatDate, formatDateTime } from '../../display/time';

/**
 * The heading that tells a reader which question the widgets below it answer.
 *
 * The admin dashboard has one filter bar and two kinds of number under it, and
 * the date range applies to only one of them. That is not a wart to hide — it
 * follows from decision D9, which split the reports in two because "what is
 * blocked" and "what was reported last month" are different tenses and a
 * single filter cannot honestly serve both.
 *
 * So the dashboard states it. Everything period-scoped sits under a
 * {@link PeriodScopeHeading} naming the dates that were actually applied — read
 * back off the response's `window`, not off the filter control, so the heading
 * cannot claim a period the server did not use. Everything current-state sits
 * under a {@link CurrentScopeHeading}, which names the instant of the snapshot
 * and says in as many words that the date range above does not reach it.
 *
 * Both take the building from the same source for the same reason: `building_id`
 * *is* honoured by both kinds of report, because it narrows which tickets are
 * in view rather than when they happened.
 */

export interface ScopeHeadingProps {
  /** The section title, e.g. "Reported in this period". */
  title: string;
  /** The building the numbers were narrowed to, or null for all of them. */
  buildingName: string | null;
}

export interface PeriodScopeHeadingProps extends ScopeHeadingProps {
  /** The window the API reported back, not the one the picker shows. */
  from: string | undefined;
  to: string | undefined;
}

/** Heading for widgets the date range applies to. */
export function PeriodScopeHeading({
  title,
  from,
  to,
  buildingName,
}: PeriodScopeHeadingProps) {
  const period = from && to ? `${formatDate(from)} – ${formatDate(to)}` : 'the selected period';

  return (
    <SectionHeading
      title={title}
      icon={<HistoryToggleOffIcon fontSize="small" color="action" />}
      detail={`Counted over ${period}${buildingSuffix(buildingName)}.`}
      testId="period-scope-heading"
    />
  );
}

export interface CurrentScopeHeadingProps extends ScopeHeadingProps {
  /** `scope.as_of` from the response — the moment the snapshot describes. */
  asOf: string | undefined;
}

/**
 * Heading for widgets the date range does **not** apply to.
 *
 * The second sentence is the important one and is deliberately blunt. A reader
 * who has just set the filter to "last 7 days" will otherwise read the number
 * below as a seven-day number, and a ticket blocked since February is exactly
 * the row these widgets exist to surface.
 */
export function CurrentScopeHeading({ title, asOf, buildingName }: CurrentScopeHeadingProps) {
  return (
    <SectionHeading
      title={title}
      icon={<UpdateIcon fontSize="small" color="action" />}
      detail={
        `As it stands at ${asOf ? formatDateTime(asOf) : 'now'}${buildingSuffix(buildingName)}. ` +
        'The date range above does not apply to these — however long something has been ' +
        'stuck, it is counted here.'
      }
      testId="current-scope-heading"
    />
  );
}

function SectionHeading({
  title,
  icon,
  detail,
  testId,
}: {
  title: string;
  icon: ReactNode;
  detail: string;
  testId: string;
}) {
  return (
    <Box sx={{ mt: 5, mb: 2 }} data-testid={testId}>
      <Divider sx={{ mb: 2 }} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {icon}
        <Typography variant="h2" component="h2">
          {title}
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: '72ch' }}>
        {detail}
      </Typography>
    </Box>
  );
}

/** ", in SFO-1" or nothing at all. */
function buildingSuffix(buildingName: string | null): string {
  return buildingName ? `, in ${buildingName}` : '';
}
