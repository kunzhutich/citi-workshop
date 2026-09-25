import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EngineerDetailReport, EngineerReview } from '../../api/reports';
import type { Engineer, Page } from '../../api/types';
import { makeAdmin, makeEngineerRow } from '../../test/factories';
import { renderWithAuth } from '../../test/renderWithProviders';

vi.mock('../../api/engineers', () => ({
  getEngineer: vi.fn(),
  listEngineers: vi.fn(),
  updateEngineer: vi.fn(),
}));
vi.mock('../../api/reports', () => ({
  fetchEngineerDetail: vi.fn(),
  fetchEngineerReviews: vi.fn(),
}));
vi.mock('../../api/facilities', () => ({ fetchFacilityTree: vi.fn() }));

const { getEngineer } = await import('../../api/engineers');
const { fetchEngineerDetail, fetchEngineerReviews } = await import('../../api/reports');
const { fetchFacilityTree } = await import('../../api/facilities');
const { EngineerReviewsPage } = await import('./EngineerReviewsPage');

/**
 * The reviews screen.
 *
 * **What is asserted here and what is not.** jsdom has no layout, so nothing
 * below says where the distribution sits or how wide a card is — those were
 * checked in a browser at 1440 and 375. What this file is for is the two
 * things that are logic rather than pixels: that the score filter reaches the
 * *request* rather than filtering an already-fetched page, and that a review
 * carries the ticket it is about.
 *
 * The filter matters more than it looks. A version that filtered client-side
 * would pass a naive "clicking 1 star shows one review" test on a single page
 * of data and be wrong the moment there were two pages — the count in the
 * pager would be the unfiltered total and page two would be empty. So the
 * assertion is on what `fetchEngineerReviews` was *called with*.
 */

const ENGINEER: Engineer = makeEngineerRow({
  user_id: 'eng-1',
  full_name: 'Priya Raman',
  level: 'SENIOR',
});

const REPORT: EngineerDetailReport = {
  window: { from: '2026-08-24T00:00:00Z', to: '2026-09-23T00:00:00Z', building_id: null },
  user_id: 'eng-1',
  resolved_in_period: 41,
  closed_in_period: 33,
  reopened_in_period: 4,
  reopen_rate_pct: 9.8,
  resolved_by_group: [],
  rated_in_period: 17,
  average_rating: 4.1,
  response_rate_pct: 41.5,
  rating_distribution: [
    { rating: 1, count: 1 },
    { rating: 2, count: 1 },
    { rating: 3, count: 3 },
    { rating: 4, count: 6 },
    { rating: 5, count: 6 },
  ],
  can_read_reviews: true,
};

const REVIEW: EngineerReview = {
  feedback_id: 'fb-1',
  rating: 2,
  comment: 'Came back the next morning.',
  created_at: '2026-09-20T10:00:00Z',
  edited_at: null,
  author: {
    id: 'u-1',
    full_name: 'Robin Reporter',
    email: 'robin@acme.inc',
    role: 'EMPLOYEE',
  },
  incident_id: 'inc-1',
  reference: 'INC-000354',
  title: 'Lighting smells of damp',
  category: 'Building & Facilities › Lighting',
  resolved_at: '2026-09-17T09:00:00Z',
};

function page(items: EngineerReview[], total = items.length): Page<EngineerReview> {
  return { items, total, page: 1, page_size: 20 };
}

beforeEach(() => {
  vi.mocked(getEngineer).mockResolvedValue(ENGINEER);
  vi.mocked(fetchEngineerDetail).mockResolvedValue(REPORT);
  vi.mocked(fetchEngineerReviews).mockResolvedValue(page([REVIEW]));
  vi.mocked(fetchFacilityTree).mockResolvedValue({ buildings: [] });
});

/**
 * Reads the router's own query string into the DOM.
 *
 * `window.location` is not it: these tests run in a `MemoryRouter`, whose
 * history never touches the address bar, so asserting on `window.location`
 * asserts on an empty string that every implementation satisfies. That is how
 * the first version of "the score reaches the URL" passed while proving
 * nothing — and it is the same shape as D24, one layer over.
 */
function LocationProbe() {
  const { search } = useLocation();
  return <output data-testid="search">{search}</output>;
}

const currentSearch = () => screen.getByTestId('search').textContent ?? '';

function render(route = '/engineers/eng-1/reviews') {
  return renderWithAuth(
    <>
      <Routes>
        <Route path="/engineers/:userId/reviews" element={<EngineerReviewsPage />} />
      </Routes>
      <LocationProbe />
    </>,
    { user: makeAdmin(), route },
  );
}

/** Render and wait until both queries have painted. */
async function renderLoaded(route?: string) {
  const result = render(route);
  await screen.findByRole('heading', { name: 'Reviews for Priya Raman' });
  await screen.findByText(REVIEW.comment);
  return result;
}

describe('the summary', () => {
  it('shows the score and how much of the work was rated', async () => {
    // The second half is the one that stops the first being misleading: an
    // average over 17 of 41 is a different claim from one over 41 of 41, and
    // a screen that shows only the number invites them to be read the same.
    await renderLoaded();

    expect(screen.getByText('4.1')).toBeInTheDocument();
    expect(screen.getByText(/17 of 41 resolved rated/)).toBeInTheDocument();
  });

  it('draws every score in the distribution, including the ones nobody gave', async () => {
    await renderLoaded();

    const scores = screen.getByRole('list', { name: 'Filter by score' });
    // Five rows whatever the data says. A histogram that drops its empty bars
    // changes shape as the numbers change, and "nobody gave this a 1" is
    // exactly the fact a reader came for.
    expect(within(scores).getAllByRole('listitem')).toHaveLength(5);
    expect(within(scores).getByRole('button', { name: /^1 star\b/ })).toBeInTheDocument();
    expect(within(scores).getByRole('button', { name: /^5 stars/ })).toBeInTheDocument();
  });
});

describe('the score filter', () => {
  it('asks the API for one score rather than filtering what it already has', async () => {
    /*
     * The assertion is on the *request*. A client-side filter would satisfy
     * "one review is shown" on a single page of data and be wrong on two: the
     * pager's total would count the unfiltered set, and page two would be
     * empty. Only the call can tell the two implementations apart.
     */
    await renderLoaded();
    vi.mocked(fetchEngineerReviews).mockClear();

    await userEvent.click(screen.getByRole('button', { name: /^2 stars/ }));

    expect(fetchEngineerReviews).toHaveBeenCalledWith(
      'eng-1',
      expect.objectContaining({ rating: 2 }),
    );
  });

  it('puts the score in the address bar, so the view can be sent to somebody', async () => {
    // An admin looking into a run of low scores should be able to paste the
    // link, which is the whole reason this is a route rather than a dialog.
    await renderLoaded();

    await userEvent.click(screen.getByRole('button', { name: /^2 stars/ }));

    expect(currentSearch()).toContain('rating=2');
  });

  it('clears back to every score', async () => {
    await renderLoaded();
    await userEvent.click(screen.getByRole('button', { name: /^2 stars/ }));
    expect(await screen.findByRole('button', { name: 'Show every score' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show every score' }));

    expect(currentSearch()).not.toContain('rating');
    expect(screen.queryByRole('button', { name: 'Show every score' })).not.toBeInTheDocument();
  });

  it('pressing the same score twice turns the filter off', async () => {
    await renderLoaded();

    await userEvent.click(screen.getByRole('button', { name: /^2 stars/ }));
    await userEvent.click(screen.getByRole('button', { name: /^2 stars/ }));

    expect(currentSearch()).not.toContain('rating');
  });
});

describe('a review', () => {
  it('names the ticket it is about, and links to it', async () => {
    // A review detached from its repair is an opinion with no subject, and
    // the link is what makes the screen actionable rather than a wall.
    await renderLoaded();

    expect(screen.getByRole('link', { name: 'INC-000354' })).toHaveAttribute(
      'href',
      '/tickets/inc-1',
    );
    expect(screen.getByText('Lighting smells of damp')).toBeInTheDocument();
    expect(screen.getByText('Building & Facilities › Lighting')).toBeInTheDocument();
  });

  it('carries both timestamps, because they are different facts', async () => {
    // When the work was done, and when the reporter got round to saying
    // something about it. The gap between the two is often the interesting
    // part, and the period filters on the first of them.
    await renderLoaded();

    expect(screen.getByText(/^rated /)).toBeInTheDocument();
    expect(screen.getByText(/^fixed /)).toBeInTheDocument();
  });

  it('says so when the reporter corrected it', async () => {
    vi.mocked(fetchEngineerReviews).mockResolvedValue(
      page([{ ...REVIEW, edited_at: '2026-09-20T10:05:00Z' }]),
    );

    await renderLoaded();

    expect(screen.getByText('(edited)')).toBeInTheDocument();
  });
});

describe('when there is nothing to show', () => {
  it('says nothing was rated, rather than showing an empty page', async () => {
    vi.mocked(fetchEngineerReviews).mockResolvedValue(page([]));

    render();
    await screen.findByRole('heading', { name: 'Reviews for Priya Raman' });

    expect(
      await screen.findByText('Nothing they resolved in this period has been rated.'),
    ).toBeInTheDocument();
  });

  it('says which score came back empty when one is filtered', async () => {
    // The two empty states are different answers and a reader needs to know
    // which they got: "nobody has rated them" and "nobody gave them a 1" mean
    // very different things about the same engineer.
    vi.mocked(fetchEngineerReviews).mockResolvedValue(page([]));

    render('/engineers/eng-1/reviews?rating=1');
    await screen.findByRole('heading', { name: 'Reviews for Priya Raman' });

    expect(await screen.findByText('No 1-star reviews in this period.')).toBeInTheDocument();
  });
});
