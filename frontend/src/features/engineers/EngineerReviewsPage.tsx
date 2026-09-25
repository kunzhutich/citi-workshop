import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import TablePagination from '@mui/material/TablePagination';
import Typography from '@mui/material/Typography';
import { Link as RouterLink, useParams, useSearchParams } from 'react-router-dom';

import type { EngineerReview } from '../../api/reports';
import { QueryState } from '../../components/QueryState';
import { RatingStars } from '../../components/RatingStars';
import { formatDateTime, relativeTime } from '../../display/time';
import { engineerPath, incidentPath } from '../../routes';
import { useEngineerDetailReport, useEngineerReviews } from '../dashboard/hooks';
import { DashboardFilterBar } from '../dashboard/DashboardFilterBar';
import { PeriodScopeHeading } from '../dashboard/ScopeHeading';
import { useDashboardFilters } from '../dashboard/useDashboardFilters';
import { useEngineer } from './hooks';

/** Rows per page. Fixed, like every other list in the application. */
const PAGE_SIZE = 20;

/** The query parameter the score filter lives in, so the view is linkable. */
const RATING_PARAM = 'rating';

/**
 * The reviews behind one engineer's rating.
 *
 * **Shaped the way service desks shape this screen**, which is worth saying
 * because the obvious version — a column of scores and sentences — is the one
 * nobody can act on. Zendesk, Freshdesk and Jira Service Management all land
 * on the same three parts, and so does this:
 *
 * 1. **A summary that says whether the average is worth reading.** The score,
 *    and beside it how many of the repairs in the period were rated at all.
 *    An average over three of forty is a different claim from an average over
 *    thirty of forty, and a page that shows only the first number invites the
 *    reader to treat them as the same.
 * 2. **A distribution you can click.** Five rows, one per score, each with its
 *    count and a bar — and each a filter. This is the control the screen is
 *    really for: almost nobody opens it to read everything, they open it to
 *    read the ones who were unhappy. It doubles as the chart, which is why
 *    there is no separate chart.
 * 3. **Rows that name the ticket.** Every review carries its reference, its
 *    title and its category, and the reference is a link. A review detached
 *    from the repair it is about is an opinion with no subject.
 *
 * **Two timestamps per row, and they are different facts.** When the repair
 * was made, and when the reporter got round to saying something about it. The
 * gap between them is often the interesting part — a five left three weeks
 * later reads differently from a five left the same afternoon — and the period
 * filter applies to the *first* of them, which is why the row says so.
 *
 * **Who may read a row is not decided here.** The API applies
 * `apply_feedback_visibility` to the query, so a colleague who reaches this
 * URL gets an empty page rather than a forbidden one. The link that leads here
 * is drawn from `can_read_reviews`; this screen renders what it is given.
 */
export function EngineerReviewsPage() {
  const { userId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const controls = useDashboardFilters();
  const { periodParams } = controls;

  const rating = parseScore(searchParams.get(RATING_PARAM));
  const page = parsePage(searchParams.get('page'));

  const engineer = useEngineer(userId);
  const report = useEngineerDetailReport(userId, periodParams);
  const reviews = useEngineerReviews(userId, {
    ...periodParams,
    rating: rating ?? undefined,
    page,
    page_size: PAGE_SIZE,
  });

  /**
   * Set or clear the score filter, resetting to the first page.
   *
   * Resetting matters: filtering to the 1s while on page three of everything
   * would otherwise show an empty list that looks like "there are none".
   */
  const applyScore = (score: number | null) => {
    const next = new URLSearchParams(searchParams);
    if (score === null) {
      next.delete(RATING_PARAM);
    } else {
      next.set(RATING_PARAM, String(score));
    }
    next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const setPage = (nextPage: number) => {
    const next = new URLSearchParams(searchParams);
    if (nextPage <= 1) {
      next.delete('page');
    } else {
      next.set('page', String(nextPage));
    }
    setSearchParams(next, { replace: true });
  };

  const name = engineer.data?.full_name ?? 'this engineer';
  const total = reviews.data?.total ?? 0;

  return (
    <Box>
      <Button
        component={RouterLink}
        to={`${engineerPath(userId)}${searchParamsWithoutRating(searchParams)}`}
        startIcon={<ArrowBackIcon />}
        sx={{ mb: 2, ml: -1 }}
      >
        {engineer.data ? engineer.data.full_name : 'Back'}
      </Button>

      <Typography variant="h1" component="h1" sx={{ mb: 0.5 }}>
        Reviews for {name}
      </Typography>

      <QueryState
        isPending={report.isPending}
        error={report.error}
        errorFallback="Could not load their rating."
      >
        {report.data ? (
          <>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 1.5,
                mb: 2,
              }}
            >
              <RatingStars
                value={report.data.average_rating}
                size="medium"
                caption={`· ${report.data.rated_in_period} of ${report.data.resolved_in_period} resolved rated`}
              />
            </Box>

            {/*
              The same heading the page above uses, read off the response's
              own `window` rather than the picker — D14's rule, and D24's: the
              dates a heading shows have to be the ones the server counted,
              not the ones a control happens to display.
            */}
            <PeriodScopeHeading
              title="Reviews in this period"
              from={report.data.window.from}
              to={report.data.window.to}
              buildingName={null}
              datesShownElsewhere
              actions={<DashboardFilterBar controls={controls} note={false} narrow />}
            />

            <ScoreFilter
              distribution={report.data.rating_distribution}
              selected={rating}
              onSelect={applyScore}
            />
          </>
        ) : null}
      </QueryState>

      <QueryState
        isPending={reviews.isPending}
        error={reviews.error}
        errorFallback="Could not load these reviews."
      >
        {total === 0 ? (
          <Alert severity="info" sx={{ mt: 2 }}>
            {rating === null
              ? 'Nothing they resolved in this period has been rated.'
              : `No ${rating}-star reviews in this period.`}
          </Alert>
        ) : (
          <>
            <Box sx={{ display: 'grid', gap: 1.5, mt: 2 }}>
              {(reviews.data?.items ?? []).map((review) => (
                <ReviewCard key={review.feedback_id} review={review} />
              ))}
            </Box>
            <TablePagination
              component="div"
              count={total}
              page={page - 1}
              onPageChange={(_event, next) => setPage(next + 1)}
              rowsPerPage={PAGE_SIZE}
              rowsPerPageOptions={[PAGE_SIZE]}
            />
          </>
        )}
      </QueryState>
    </Box>
  );
}

/**
 * The distribution, and the filter, as one control.
 *
 * Five rows whatever the data says, because the API always sends five — a
 * histogram that drops its empty bars changes shape as the numbers change,
 * and "nobody gave this a 1" is exactly the fact a reader came for.
 *
 * One colour for every bar, not a five-step ramp. `chartPalette.ts` carries a
 * validated ordinal ramp of **four** steps and no ordinal set of five, and
 * inventing one here is how a colour arrives un-derived — D48, D50 and D57 are
 * the three entries about that happening. The score on each row carries the
 * identity instead, which is what the status chart does for the same reason.
 */
function ScoreFilter({
  distribution,
  selected,
  onSelect,
}: {
  distribution: { rating: number; count: number }[];
  selected: number | null;
  onSelect: (score: number | null) => void;
}) {
  const largest = Math.max(...distribution.map((row) => row.count), 1);
  const rows = [...distribution].sort((a, b) => b.rating - a.rating);

  return (
    <Box sx={{ mt: 2 }}>
      {/*
        The control says what it is. Five clickable rows with no heading are
        five rows nobody clicks: a bar chart and a filter look identical until
        somebody tries one, and a reader who does not know these are pressable
        has the distribution and not the thing the screen is for. Found by
        looking at the rendered page, where nothing announced it.
      */}
      <Typography
        id="score-filter-label"
        variant="subtitle2"
        component="h2"
        sx={{ mb: 0.5 }}
      >
        Filter by score
      </Typography>
      <Box
        component="ul"
        aria-labelledby="score-filter-label"
        sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 0.5, maxWidth: 420 }}
      >
        {rows.map((row) => (
          <Box component="li" key={row.rating}>
            <Box
              component="button"
              type="button"
              onClick={() => onSelect(selected === row.rating ? null : row.rating)}
              aria-pressed={selected === row.rating}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                width: '100%',
                px: 1,
                py: 0.5,
                border: 'none',
                borderRadius: 1,
                cursor: 'pointer',
                font: 'inherit',
                textAlign: 'left',
                bgcolor: selected === row.rating ? 'action.selected' : 'transparent',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              {/* The score in words as well as in digits: "4" alone beside a
                  bar is not something a screen reader can make sense of. */}
              <Typography variant="body2" sx={{ minWidth: 56, flexShrink: 0 }}>
                {row.rating} star{row.rating === 1 ? '' : 's'}
              </Typography>
              <LinearProgress
                variant="determinate"
                value={(row.count / largest) * 100}
                aria-hidden
                sx={{ flexGrow: 1, height: 8, borderRadius: 1 }}
              />
              <Typography variant="body2" color="text.secondary" sx={{ minWidth: 24 }}>
                {row.count}
              </Typography>
            </Box>
          </Box>
        ))}
      </Box>

      {selected !== null ? (
        <Button size="small" onClick={() => onSelect(null)} sx={{ mt: 0.5, ml: 0.5 }}>
          Show every score
        </Button>
      ) : null}
    </Box>
  );
}

/** One review: the score, the words, and the repair it is about. */
function ReviewCard({ review }: { review: EngineerReview }) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <RatingStars value={review.rating} size="small" showValue={false} />
          <Typography variant="subtitle2" component="span">
            {review.author.full_name}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            component="time"
            title={formatDateTime(review.created_at)}
          >
            rated {relativeTime(review.created_at)}
          </Typography>
          {review.edited_at ? (
            <Typography variant="caption" color="text.secondary">
              (edited)
            </Typography>
          ) : null}
        </Box>

        <Typography
          variant="body2"
          sx={{ mt: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
        >
          {review.comment}
        </Typography>

        {/* The ticket. Without it a review is an opinion with no subject. */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'baseline',
            flexWrap: 'wrap',
            gap: 1,
            mt: 1.5,
            pt: 1.5,
            borderTop: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Link component={RouterLink} to={incidentPath(review.incident_id)} variant="body2">
            {review.reference}
          </Link>
          <Typography variant="body2" sx={{ minWidth: 0 }}>
            {review.title}
          </Typography>
          <Chip label={review.category} size="small" variant="outlined" />
          {review.resolved_at ? (
            <Typography
              variant="caption"
              color="text.secondary"
              component="time"
              title={formatDateTime(review.resolved_at)}
            >
              {/* The other timestamp, and the one the period filters on. */}
              fixed {relativeTime(review.resolved_at)}
            </Typography>
          ) : null}
        </Box>
      </CardContent>
    </Card>
  );
}

/** Read the score filter out of the address bar, ignoring anything off the scale. */
function parseScore(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }
  const score = Number(raw);
  return Number.isInteger(score) && score >= 1 && score <= 5 ? score : null;
}

/** Read the page number, defaulting to the first. */
function parsePage(raw: string | null): number {
  const page = Number(raw ?? '1');
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/**
 * The query string to carry back to the engineer's page.
 *
 * The period goes back with the reader, so returning does not silently reset
 * the dates they chose. The score filter does not: it means nothing on a page
 * that has no list of reviews on it.
 */
function searchParamsWithoutRating(searchParams: URLSearchParams): string {
  const next = new URLSearchParams(searchParams);
  next.delete(RATING_PARAM);
  next.delete('page');
  const query = next.toString();
  return query ? `?${query}` : '';
}
