/**
 * Every route path in the application, named once.
 *
 * Guards, navigation and redirects all reference the same constant, so a path
 * can be changed in one place and nothing quietly keeps pointing at the old
 * one. The values are the URLs users see and bookmark.
 */
export const paths = {
  login: '/login',
  register: '/register',
  changePassword: '/change-password',

  /** The persona home page. Which screen that is depends on the role. */
  home: '/',
  report: '/report',
  notifications: '/notifications',
  myTickets: '/tickets/mine',
  allTickets: '/tickets',
  /**
   * One ticket's detail page.
   *
   * A sibling of `/tickets/mine`, which is safe because React Router ranks a
   * static segment above a dynamic one — `/tickets/mine` never matches this.
   */
  incidentDetail: '/tickets/:incidentId',

  myQueue: '/queue',
  unassigned: '/unassigned',
  team: '/team',

  engineers: '/engineers',
  /**
   * One engineer's page — §6.1.
   *
   * Keyed on the *user* id rather than a profile id, because
   * `engineer_profiles` is keyed that way too: the profile is an extension of
   * a user and has no identity of its own.
   */
  engineerDetail: '/engineers/:userId',
  /**
   * The reviews behind one engineer's rating — S7 part 2.
   *
   * A route rather than a dialog on the page above it. The content is a list
   * that wants filtering and paging and links out to tickets, all of which a
   * modal makes awkward, and an admin looking into somebody's low scores
   * should be able to send the link. It carries the period in its query
   * string, so what it shows is the set the number that led here counted.
   *
   * Reachable by any member of staff, like the page above it; who may see
   * *rows* is `apply_feedback_visibility`, so a colleague who guesses the URL
   * gets an empty list rather than a forbidden one.
   */
  engineerReviews: '/engineers/:userId/reviews',
  facilities: '/facilities',
  categories: '/categories',
  users: '/users',
} as const;

export type AppPath = (typeof paths)[keyof typeof paths];

/** The URL of one ticket's detail page. */
export function incidentPath(incidentId: string): string {
  return `/tickets/${incidentId}`;
}

/** The URL of one engineer's page. */
export function engineerPath(userId: string): string {
  return `/engineers/${userId}`;
}

/** The URL of the reviews behind one engineer's rating. */
export function engineerReviewsPath(userId: string): string {
  return `/engineers/${userId}/reviews`;
}
