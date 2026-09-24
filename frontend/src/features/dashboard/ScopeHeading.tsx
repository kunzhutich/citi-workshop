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
 *
 * **The same split, on a screen with no room for two headings.** R7 put the
 * period controls on the engineer page beside the very heading they scope, so
 * the dated sentence under that heading became a second statement of what the
 * control already says. What the sentence was *also* doing — marking where the
 * period half of the screen begins and the right-now half ends — still has to
 * be done, and the engineer page's two halves sit side by side rather than one
 * after the other, so neither of them has room for a heading and a sentence.
 * {@link ScopeLabel} is that mark in three words: the same two tenses, the same
 * two icons, no prose. `datesShownElsewhere` is what swaps one for the other,
 * and it defaults to false so the dashboard keeps its sentence without asking.
 */

/** Which tense a group of widgets is in. This application has exactly two. */
export type ScopeKind = 'period' | 'current';

/**
 * How much of a title row a section's own controls may ask for.
 *
 * The only thing ever passed as `actions` is `DashboardFilterBar`, and this is
 * what its two selects want side by side: 200px each and the 16px between
 * them. It is written here rather than there because a box cannot ask its
 * parent for room — the parent is the only one who can offer it.
 */
const ACTIONS_WIDTH = 416;

/**
 * The icon and the words for each tense, written down once.
 *
 * Two screens now say "Right now" and mean the same thing by it — the
 * dashboard as an `h2`, the engineer page as a label over one column — and the
 * wording drifting apart would make them look like two different claims.
 */
const SCOPE_MARKS: Record<ScopeKind, { words: string; icon: ReactNode }> = {
  period: {
    words: 'Over the selected period',
    icon: <HistoryToggleOffIcon fontSize="small" color="action" />,
  },
  current: {
    words: 'Right now',
    icon: <UpdateIcon fontSize="small" color="action" />,
  },
};

export interface ScopeLabelProps {
  kind: ScopeKind;
}

/**
 * The scope in three words, for a column that cannot carry a heading.
 *
 * Deliberately vague about the dates, and that is the honest reading rather
 * than a shortcut: "over the selected period" claims only that whatever the
 * control says was applied, where "counted over 24 Aug – 23 Sep 2026" is a
 * claim about two specific instants and therefore has to come from the
 * server's own `window` (D14, D24). A label that named dates it had not read
 * back would be the defect those entries exist to prevent, one size smaller.
 *
 * It carries its own vertical spacing because it is always the same thing —
 * a marker between a title and the widgets it scopes — and a caller choosing
 * its own margins is how two of these come to sit at different heights.
 */
export function ScopeLabel({ kind }: ScopeLabelProps) {
  const mark = SCOPE_MARKS[kind];

  return (
    <Box
      data-testid={`scope-label-${kind}`}
      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5, mb: 1 }}
    >
      {mark.icon}
      <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.6 }}>
        {mark.words}
      </Typography>
    </Box>
  );
}

export interface ScopeHeadingProps {
  /** The section title, e.g. "Reported in this period". */
  title: string;
  /** The building the numbers were narrowed to, or null for all of them. */
  buildingName: string | null;
  /**
   * Controls for this section, at the trailing edge of the title row.
   *
   * The engineer page's date range and building picker live here, because on
   * that screen they scope one half of the page rather than the whole of it —
   * and a filter bar at the top would then be claiming the half above it too.
   * Empty on the admin dashboard, where the bar is the page's and belongs
   * above both sections.
   *
   * Whatever is passed gets {@link ACTIONS_WIDTH} to arrange itself in, or the
   * whole line where that is narrower — a slot, rather than however much room
   * its own contents happened to demand.
   */
  actions?: ReactNode;
}

export interface PeriodScopeHeadingProps extends ScopeHeadingProps {
  /** The window the API reported back, not the one the picker shows. */
  from: string | undefined;
  to: string | undefined;
  /**
   * The screen states its period some other way, so this heading does not.
   *
   * **False by default, and the default is the one that must not move.** The
   * admin dashboard has nothing else on it that names the window — its filter
   * bar says "Last 30 days", which is a control and not a statement of what
   * the server counted — so removing that sentence there would take the
   * screen back to the state D9 and D14 were raised about. The engineer page
   * passes true because the date-range control sits inside this heading's own
   * `actions`, an inch from the words, and two statements of one period where
   * one of them is a control is one too many.
   */
  datesShownElsewhere?: boolean;
}

/** Heading for widgets the date range applies to. */
export function PeriodScopeHeading({
  title,
  from,
  to,
  buildingName,
  actions,
  datesShownElsewhere = false,
}: PeriodScopeHeadingProps) {
  const period = from && to ? `${formatDate(from)} – ${formatDate(to)}` : 'the selected period';

  return (
    <SectionHeading
      title={title}
      // The clock rides with whichever line actually states the scope: beside
      // the title when that is the dated sentence below it, inside the label
      // when the label is all there is. Two clocks an inch apart read as two
      // different marks for one fact.
      icon={datesShownElsewhere ? null : SCOPE_MARKS.period.icon}
      detail={
        datesShownElsewhere ? (
          <ScopeLabel kind="period" />
        ) : (
          <HeadingDetail>{`Counted over ${period}${buildingSuffix(buildingName)}.`}</HeadingDetail>
        )
      }
      actions={actions}
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
export function CurrentScopeHeading({
  title,
  asOf,
  buildingName,
  actions,
}: CurrentScopeHeadingProps) {
  return (
    <SectionHeading
      title={title}
      icon={SCOPE_MARKS.current.icon}
      detail={
        <HeadingDetail>
          {`As it stands at ${asOf ? formatDateTime(asOf) : 'now'}${buildingSuffix(buildingName)}. ` +
            'The date range above does not apply to these — however long something has been ' +
            'stuck, it is counted here.'}
        </HeadingDetail>
      }
      actions={actions}
      testId="current-scope-heading"
    />
  );
}

function SectionHeading({
  title,
  icon,
  detail,
  actions,
  testId,
}: {
  title: string;
  icon: ReactNode;
  detail: ReactNode;
  actions: ReactNode;
  testId: string;
}) {
  return (
    <Box sx={{ mt: 5, mb: 2 }} data-testid={testId}>
      <Divider sx={{ mb: 2 }} />
      {/* Title on one side, this section's own controls on the other, wrapping
          under rather than squeezing the heading — the same arrangement, and
          the same reasoning, as `PageHeader`. */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 2,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {icon}
            <Typography variant="h2" component="h2">
              {title}
            </Typography>
          </Box>
          {detail}
        </Box>
        {/* `min(100%, ACTIONS_WIDTH)` where this used to be `minWidth: 0`, and
            the two halves of that expression answer two different faults.

            The `0` was there to let the box shrink, which is what stops 424px
            of selects being carried onto a 327px phone line and scrolling the
            whole document sideways — D44's fault exactly. `min(100%, …)` keeps
            that, and keeps it the same way `FilterRow` does: on a phone the
            percentage is the smaller half, so this box is never wider than the
            line it sits on, whatever is inside it.

            What the `0` also did was leave the box sized to exactly its own
            contents, and a filter bar asked to arrange itself inside its
            max-content width has nothing to arrange — the engineer page's two
            selects came down one per line with several hundred pixels of
            nothing beside them. A slot worth dividing is the other half. */}
        {actions ? (
          <Box sx={{ minWidth: `min(100%, ${ACTIONS_WIDTH}px)` }}>{actions}</Box>
        ) : null}
      </Box>
    </Box>
  );
}

/** The sentence under a heading's title. */
function HeadingDetail({ children }: { children: ReactNode }) {
  return (
    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: '72ch' }}>
      {children}
    </Typography>
  );
}

/** ", in SFO-1" or nothing at all. */
function buildingSuffix(buildingName: string | null): string {
  return buildingName ? `, in ${buildingName}` : '';
}
