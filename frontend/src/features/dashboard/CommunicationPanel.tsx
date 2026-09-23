import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import type { CommunicationReport } from '../../api/reports';
import { formatHours } from '../../display/time';
import { StatTile, StatTileGrid } from './StatTile';

export interface CommunicationPanelProps {
  report: CommunicationReport | undefined;
  /** Dimmed while a refetch is in flight, so a stale number looks stale. */
  isStale?: boolean;
}

/**
 * The brief's question — "are employees being kept informed?" — with a number.
 *
 * `/reports/communication` has existed since M7 and nothing rendered it. That
 * was defensible while there was no answer to the question beyond "somebody
 * should write a note"; S1 added the other half, so the whole thing is now on
 * screen together: how often a reporter was told *something* before their
 * ticket was resolved, how long the first update took, how often they had to
 * reopen it, and — new — how much of what the application sent them they have
 * actually read.
 *
 * **None of these five tiles links anywhere**, which is a rule from
 * `StatTile`'s own docstring rather than an omission: a percentage and a
 * median have no list behind them, and `GET /incidents` cannot filter on
 * "had a public staff note before resolution" in any case. A tile that opened
 * the wrong tickets would be worse than one that does not move.
 *
 * **A null is rendered as an em dash, never as zero.** "No ticket was resolved
 * in this period" and "no resolved ticket was kept informed" are different
 * facts, and the API is careful to distinguish them (`informed_pct` is `null`
 * rather than `0` when the denominator is empty). Collapsing that here would
 * throw the distinction away at the last possible moment.
 */
export function CommunicationPanel({ report, isStale = false }: CommunicationPanelProps) {
  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="h3" component="h3" gutterBottom>
        Whether people were kept informed
      </Typography>
      <StatTileGrid>
        <StatTile
          label="Told before it was fixed"
          value={percent(report?.informed_pct)}
          caption={informedCaption(report)}
          isStale={isStale}
        />
        <StatTile
          label="Median time to first update"
          value={formatHours(report?.median_first_public_note_hours ?? null)}
          caption="From reporting to the first public note by staff"
          isStale={isStale}
        />
        <StatTile
          label="Notifications read"
          value={percent(report?.notification_read_rate_pct)}
          caption={readCaption(report)}
          isStale={isStale}
        />
        <StatTile
          label="Reopened"
          value={percent(report?.reopen_rate_pct)}
          caption={reopenCaption(report)}
          isStale={isStale}
        />
      </StatTileGrid>
    </Box>
  );
}

/** A percentage, or an em dash when there was nothing to take a share of. */
function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value}%`;
}

function informedCaption(report: CommunicationReport | undefined): string {
  if (!report || report.resolved_total === 0) {
    return 'No ticket reported in this period has been resolved yet';
  }
  return `${report.informed_total} of ${report.resolved_total} resolved tickets had a public update first`;
}

function readCaption(report: CommunicationReport | undefined): string {
  if (!report || report.notifications_total === 0) {
    return 'Nothing was sent to a reporter in this period';
  }
  return `${report.notifications_read_total} of ${report.notifications_total} sent to reporters in this period`;
}

function reopenCaption(report: CommunicationReport | undefined): string {
  if (!report || report.total === 0) {
    return 'Nothing was reported in this period';
  }
  return `${report.reopened_total} of ${report.total} were reopened at least once`;
}
