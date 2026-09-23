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
  myTickets: '/tickets/mine',
  allTickets: '/tickets',

  myQueue: '/queue',
  unassigned: '/unassigned',
  team: '/team',

  engineers: '/engineers',
  facilities: '/facilities',
  categories: '/categories',
  users: '/users',
} as const;

export type AppPath = (typeof paths)[keyof typeof paths];
