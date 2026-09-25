import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { Link as RouterLink, useLocation, useParams } from 'react-router-dom';

import { LevelChip } from '../../components/LevelChip';
import { RatingStars } from '../../components/RatingStars';
import { QueryState } from '../../components/QueryState';
import { availabilityLabel } from '../../display/labels';
import { engineerReviewsPath, paths } from '../../routes';
import { BreakdownChart } from '../dashboard/BreakdownChart';
import { DashboardFilterBar } from '../dashboard/DashboardFilterBar';
import type { EngineerDetailReport } from '../../api/reports';
import { useEngineerDetailReport } from '../dashboard/hooks';
import { PeriodScopeHeading, ScopeLabel } from '../dashboard/ScopeHeading';
import { StatTile, StatTileGrid } from '../dashboard/StatTile';
import { useDashboardFilters } from '../dashboard/useDashboardFilters';
import { HomeTicketRow } from '../home/HomeTicketRow';
import { useIncidents } from '../incidents/hooks';
import { IncidentsPage } from '../incidents/IncidentsPage';
import { CapacityBar } from './CapacityBar';
import { EngineerBasics } from './EngineerBasics';
import { useEngineer } from './hooks';

/** How many of their current tickets the live section lists. */
const CURRENT_LIMIT = 8;

/**
 * The two sections above the divider: what each wants, and what each gets.
 *
 * Flex bases rather than a breakpoint, deliberately. D44 is the entry about a
 * layout switched on the *window's* width while the box holding it was 248px
 * of drawer and 48px of padding narrower — these ask the box instead, so the
 * sections split when there is room for them and stack when there is not,
 * whatever the window is doing around them.
 *
 * **They are 3:7 and not 1:1**, because the two sides are not the same job.
 * The left is seven fields and a Save button, and a form does not read better
 * for being wider; the right is a queue of tickets, which does. The grow
 * factors are 3 and 7 to match, and the bases are in that ratio too — which is
 * what holds the split at *every* width rather than at one. Even bases with
 * uneven growth drift back towards even as the container widens, because the
 * even part is fixed and only the remainder is shared.
 *
 * Their sum is what decides when the split stops being a split, and it is the
 * 680px the even halves added up to, so the width at which the two stack has
 * not moved. Below it each one is alone on its line and takes all of it.
 */
const DETAILS_BASIS = 204;
const CURRENT_BASIS = 476;

/**
 * How long the capacity bar is on this screen.
 *
 * `CapacityBar` asks for 120px and is right to: the roster draws one in every
 * row of a table, the dashboard's workload table does the same, and the assign
 * dialog puts one beside every candidate — a bar that claimed 320px in any of
 * those would push what is next to it off the screen. So the room comes from
 * this caller, a wrapper this box's width which the bar then fills, rather
 * than from a prop. A prop would be a second place to decide one thing, and
 * with all three of the other callers wanting the default it would exist to be
 * passed exactly once.
 *
 * A definite width rather than `1 1 auto`: a bar is read as a proportion, and
 * past a point more length does not make "17 / 15" any clearer — it only
 * leaves the availability word stranded at the far end of a 700px line.
 */
const CAPACITY_BAR_WIDTH = 320;

/**
 * Narrowest a column of live tickets may be before there is only one of them.
 *
 * The live section is 70% of the line and holds two columns, so each is about
 * 35% of the page — but "two columns" has to be something the box decides
 * rather than a number written down, or a phone gets two 160px cards. This is
 * `auto-fit` with a floor, which is the answer `FilterRow` gives to the same
 * question for the same reason (D44): two columns while two of these and the
 * gap fit, one when they do not. On a 375px screen the sections have already
 * stacked, so this box is the full 343px of it, and one column is what fits.
 */
const TICKET_COLUMN = 260;

/**
 * One engineer's page — §6.1 of the redesign brief, rearranged in R7.
 *
 * It replaces an "Edit engineer" modal, and the difference is not that a page
 * is bigger than a dialog. A dialog can only answer *what are this person's
 * settings*; the question anybody actually arrives with is **how are they
 * doing** — what have they fixed, what is on their plate, and how much of
 * their work came back. Those need a period, a chart and a list, none of which
 * fit in a modal and all of which the API could already nearly answer.
 *
 * **The reopen figure is the point of the page, and it is a careful number.**
 * It counts tickets this engineer resolved in the window that carry a reopen —
 * not tickets reopened *because their fix failed*, which would need the event
 * log walked to find whose RESOLVED each REOPENED followed. The screen says
 * "resolved, then reopened" for exactly that reason, and the tooltip says the
 * rest. A quality signal that overstates itself is worse than none.
 *
 * **The period applies to the figures, not to the current work**, which is
 * D9's rule and the thing this layout has to keep visible. The page used to
 * rely on a sentence under the filter bar saying so. It now says it the way
 * the admin dashboard does (D14): two scope labels, one over each half —
 * "Right now" over the capacity bar and the live queue, "Over the selected
 * period" over the tiles and the chart — and the date controls sit inside the
 * period heading rather than above the whole page, so they cannot look like
 * they reach the half above them.
 *
 * **The top of the page is 30/70 rather than in halves**, which is the shape
 * of the two questions rather than a preference. The left is a form — seven
 * fields that do not read better for being wider — and the right is a queue,
 * which does: at 70% it holds two columns of tickets instead of one, so eight
 * of them are four rows rather than eight and the divider below is reachable
 * without scrolling past them. Every number in that arrangement is a flex
 * basis or a grid floor, so the container decides when it stops being an
 * arrangement: on a phone the two sections stack and the two ticket columns
 * become one, and nothing had to know how wide the window was (D44).
 *
 * **The ticket table at the bottom is `IncidentsPage` with a preset**, the
 * same component the four list screens are. It brings its own filter bar,
 * paging and empty state, which is the entire reason to reuse it; `embedded`
 * is the one thing it is told, and all that does is stop it claiming the
 * page's `h1`. Its scope is a third one — every ticket ever assigned to this
 * person, finished work last — so its own description says so rather than
 * letting the period label above it be read over it.
 */
export function EngineerDetailPage() {
  const { userId = '' } = useParams();
  // Carried to the reviews link verbatim. `listLinks.ts`'s rule is that a
  // link carries the same scope the number was computed under, and the
  // literal query string is the strongest form of that: the reviews page
  // reads it with the same hook this page does, so the two cannot resolve a
  // period differently.
  const location = useLocation();
  const controls = useDashboardFilters();
  const { periodParams } = controls;

  const engineer = useEngineer(userId);
  const report = useEngineerDetailReport(userId, periodParams);

  // Their live queue, unscoped by the period on purpose.
  const current = useIncidents({
    assignee_id: userId,
    status: ['OPEN', 'IN_PROGRESS', 'BLOCKED'],
    sort: '-priority',
    page_size: CURRENT_LIMIT,
  });

  const reportWindow = report.data?.window;
  const currentTotal = current.data?.total ?? 0;

  return (
    <Box>
      <Button
        component={RouterLink}
        to={paths.engineers}
        startIcon={<ArrowBackIcon />}
        sx={{ mb: 2, ml: -1 }}
      >
        Engineers
      </Button>

      <QueryState
        isPending={engineer.isPending}
        error={engineer.error}
        errorFallback="Could not load this engineer."
      >
        {engineer.data ? (
          <>
            {/*
              The page's own `h1`, rather than `PageHeader`.
              `PageHeader.title` is a string by construction, and the level
              belongs *inside* the title line — "Priya Raman, Lead" is one
              fact about one person, where a chip at the far end of the header
              row reads as a control for the screen. `TicketTitle`'s `page`
              density is the same exception for the same reason.
            */}
            <Box sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography variant="h1" component="h1">
                  {engineer.data.full_name}
                </Typography>
                <LevelChip level={engineer.data.level} />
                {/*
                  How their work was rated, beside their name because that is
                  the question this page exists to answer and a reader should
                  not have to scroll to it.

                  **It is a period figure sitting above the period heading**,
                  which is the one thing about this block that needed an
                  argument. Everything else on this page is split into "Right
                  now" and "Over the selected period" (D9, D14) precisely so
                  that no number can be read against the wrong scope — and a
                  rating next to somebody's name reads as a standing fact
                  about them rather than as thirty days of it.

                  Resolved by saying so in the line itself rather than by
                  moving the stars: the sentence directly under them ends "in
                  this period", so the scope travels with the number instead
                  of depending on a heading four hundred pixels below it. A
                  lifetime average beside a period one was the alternative and
                  is worse — two averages of the same thing, differing, with
                  nothing on the screen to say which is which.
                */}
                {/*
                  The score and the way into the reviews are one block, so
                  the link sits directly under the stars it belongs to rather
                  than under the email. They are two halves of one statement
                  — "4.5, over this many of their repairs" — and a line of
                  contact details between them read as though the link
                  belonged to the address above it.
                */}
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <RatingStars value={report.data?.average_rating ?? null} size="small" />
                  <RatedCount report={report.data} userId={userId} search={location.search} />
                </Box>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {engineer.data.email}
              </Typography>
            </Box>

            {!engineer.data.is_active ? (
              <Alert severity="warning" sx={{ mb: 2 }}>
                This account is deactivated. They cannot sign in, and their history stays.
              </Alert>
            ) : null}

            {/* --- Their settings, and what they are holding ---------------- */}

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'flex-start' }}>
              <Box sx={{ flex: `3 1 ${DETAILS_BASIS}px`, minWidth: 0 }}>
                {/*
                  The heading the card used to draw inside itself, lifted out
                  of it — and written here rather than left there, because its
                  size is a fact about the *pair*: it has to match "On their
                  plate now" opposite, and a pair that must match is easier to
                  keep matching when both ends are in one file.

                  Out of the card is what puts the two sections on one line. A
                  heading inside a `CardContent` starts 16px of padding below
                  the top of its column, so the left side began lower than the
                  right for no reason a reader could see. The margins are the
                  ones `ScopeLabel` carries opposite, so what follows each
                  heading — the card here, the capacity bar there — starts at
                  the same height as well.
                */}
                <Typography variant="h3" component="h2" sx={{ mt: 0.5, mb: 1 }}>
                  Details
                </Typography>
                <EngineerBasics engineer={engineer.data} />
              </Box>

              <Box sx={{ flex: `7 1 ${CURRENT_BASIS}px`, minWidth: 0 }}>
                <ScopeLabel kind="current" />

                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 2,
                    mb: 3,
                  }}
                >
                  {/* The bar fills this box, so this box is how long the bar
                      is. See `CAPACITY_BAR_WIDTH` for why the length is asked
                      for here and not inside the component. */}
                  <Box sx={{ flex: `0 1 ${CAPACITY_BAR_WIDTH}px`, minWidth: 0 }}>
                    <CapacityBar
                      active={engineer.data.active_ticket_count}
                      max={engineer.data.max_active_tickets}
                    />
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {availabilityLabel(engineer.data.availability)}
                  </Typography>
                </Box>

                <Typography variant="h3" component="h2">
                  On their plate now
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mb: 1 }}
                >
                  Open, in progress or blocked — however long ago it was reported.
                </Typography>

                <QueryState
                  isPending={current.isPending}
                  error={current.error}
                  errorFallback="Could not load their current tickets."
                >
                  {(current.data?.items.length ?? 0) === 0 ? (
                    <Alert severity="info">Nothing is assigned to them right now.</Alert>
                  ) : (
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${TICKET_COLUMN}px), 1fr))`,
                        gap: 1.5,
                      }}
                    >
                      {(current.data?.items ?? []).map((incident) => (
                        <HomeTicketRow key={incident.id} incident={incident} />
                      ))}
                      {currentTotal > CURRENT_LIMIT ? (
                        /*
                         * A sentence where there used to be a link to
                         * `/tickets?assignee_id=…`. That link now sends a
                         * reader off the page to reach a table that is four
                         * hundred pixels below them.
                         *
                         * `1 / -1` because it is about the whole list rather
                         * than about the column it would otherwise land in,
                         * beside the last ticket and reading as a note on it.
                         */
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ gridColumn: '1 / -1' }}
                        >
                          The {CURRENT_LIMIT} most urgent of {currentTotal}. Every ticket they
                          have ever had, finished work included, is in the table below.
                        </Typography>
                      ) : null}
                    </Box>
                  )}
                </QueryState>
              </Box>
            </Box>

            {/* --- What they got through, over the chosen period ------------ */}

            <PeriodScopeHeading
              title="What they got through"
              // Still read off the response rather than the picker, even
              // though `datesShownElsewhere` means no reader sees them: the
              // day this heading shows its dates again, they must be the
              // server's own. See D14 and D24.
              from={reportWindow?.from}
              to={reportWindow?.to}
              buildingName={null}
              datesShownElsewhere
              /*
               * `note={false}` and not a shorter sentence. The bar's caption
               * exists on the dashboard because nothing else there says which
               * widgets the dates reach; here the two scope labels say it
               * structurally, above the things they are about, and a third
               * statement of it would be the line nobody reads.
               *
               * `narrow` because this is the bar in a slot rather than across
               * a page: the two selects divide the room the heading gives them
               * instead of asking for 200px each, and a custom range opens on
               * a row underneath instead of between them.
               */
              actions={<DashboardFilterBar controls={controls} note={false} narrow />}
            />

            <QueryState
              isPending={report.isPending}
              error={report.error}
              errorFallback="Could not load this engineer's figures."
            >
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'stretch' }}>
                {/* Two fifths and three fifths when they share a line, one
                    above the other when they cannot. The grow factors are
                    what make the split uneven; the bases are what decide
                    when it stops being a split at all. */}
                <Box sx={{ flex: '1 1 250px', minWidth: 0 }}>
                  <StatTileGrid stack>
                    <StatTile
                      label="Resolved"
                      value={report.data?.resolved_in_period ?? 0}
                      caption="Tickets they marked fixed in this period"
                      isStale={report.isFetching}
                    />
                    <StatTile
                      label="Closed"
                      value={report.data?.closed_in_period ?? 0}
                      caption="Of those, agreed finished by the reporter or an admin"
                      isStale={report.isFetching}
                    />
                    <StatTile
                      label="Resolved, then reopened"
                      value={report.data?.reopened_in_period ?? 0}
                      caption={
                        report.data?.reopen_rate_pct === null || report.data === undefined
                          ? 'Nothing resolved in this period'
                          : `${report.data.reopen_rate_pct}% of what they resolved came back`
                      }
                      isStale={report.isFetching}
                    />
                  </StatTileGrid>
                </Box>

                <Box sx={{ flex: '1.7 1 360px', minWidth: 0 }}>
                  <BreakdownChart
                    title="What they fix"
                    caption="Resolved in this period, by category group"
                    emptyMessage="Nothing resolved in this period"
                    isStale={report.isFetching}
                    /*
                     * A pie, as §D3 of the brief asks. It is worth recording
                     * that this is the one chart on the application whose
                     * shape the palette does not endorse: D57 caps a pie at
                     * the three categorical slice colours that clear the
                     * all-pairs gates, and there are eight category groups.
                     * No colour is passed, so every slice is the one series
                     * colour `chartPalette.ts` prescribes for a many-category
                     * breakdown — which means the legend names eight shares
                     * that nothing on the arc distinguishes. The table toggle
                     * in the card's own header is what makes it readable, and
                     * bars are what would make it legible.
                     */
                    shape="pie"
                    data={(report.data?.resolved_by_group ?? []).map((row) => ({
                      key: row.group_id,
                      label: row.group_name,
                      value: row.count,
                      // Straight to the tickets the slice counted, filtered
                      // the same way the number was.
                      href: `${paths.allTickets}?assignee_id=${userId}&group_id=${row.group_id}`,
                    }))}
                  />
                </Box>
              </Box>
            </QueryState>

            {/* --- Every ticket they have had ------------------------------- */}

            <Divider sx={{ mt: 5, mb: 3 }} />

            <IncidentsPage
              embedded
              title="Their tickets"
              description="Everything ever assigned to them, finished work last. This list has
                           its own filters and its own paging; the date range above does not
                           reach it."
              // The same shape as My Queue, pointed at somebody else: §5.6's
              // `closed_last` is a prefix to whatever sort is applied, so
              // finished work sinks however the list is arranged.
              preset={{ assignee_id: userId, closed_last: true }}
              emptyTitle="Nothing has ever been assigned to them"
              emptyDescription="Work assigned to them by a lead or an admin appears here."
            />
          </>
        ) : null}
      </QueryState>
    </Box>
  );
}

/**
 * How much of their work was rated, and the way in to the reviews behind it.
 *
 * **Two different things depending on who is looking, and deliberately not
 * two different facts.** Every member of staff sees this sentence: the
 * response rate is an aggregate, and the owner's rule is that engineers may
 * see one another's *scores*. Only an admin, a lead or this engineer
 * themselves gets it as a link, because the sentences behind it are theirs
 * alone — and that is `can_read_reviews` from the API rather than a role test
 * here. `apply_feedback_visibility` enforces it either way; this only decides
 * whether a link is drawn onto something a colleague would find empty.
 *
 * It ends "in this period" because it is a period figure sitting above the
 * period heading. See the note where the stars are rendered.
 */
function RatedCount({
  report,
  userId,
  search,
}: {
  report: EngineerDetailReport | undefined;
  userId: string;
  search: string;
}) {
  if (report === undefined) {
    return null;
  }

  const { rated_in_period: rated, resolved_in_period: resolved } = report;
  if (resolved === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        Nothing resolved in this period
      </Typography>
    );
  }

  const sentence = `${rated} of ${resolved} resolved rated in this period`;

  if (!report.can_read_reviews || rated === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {sentence}
      </Typography>
    );
  }

  return (
    <Link
      component={RouterLink}
      to={`${engineerReviewsPath(userId)}${search}`}
      variant="body2"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}
    >
      {sentence}
      <ChevronRightIcon fontSize="small" />
    </Link>
  );
}
