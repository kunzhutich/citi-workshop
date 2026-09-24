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
