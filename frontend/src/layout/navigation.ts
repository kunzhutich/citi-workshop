import AddCircleOutlinedIcon from '@mui/icons-material/AddCircleOutlined';
import ApartmentIcon from '@mui/icons-material/Apartment';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import CategoryIcon from '@mui/icons-material/Category';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import DashboardIcon from '@mui/icons-material/Dashboard';
import EngineeringIcon from '@mui/icons-material/Engineering';
import GroupsIcon from '@mui/icons-material/Groups';
import HomeIcon from '@mui/icons-material/Home';
import InboxIcon from '@mui/icons-material/Inbox';
import ListAltIcon from '@mui/icons-material/ListAlt';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import type { ComponentType } from 'react';

import type { CurrentUser, EngineerLevel } from '../api/types';
import { paths } from '../routes';

/**
 * Who sees which navigation items.
 *
 * The lists come straight from BUILD-PLAN.md section 10 and live here as
 * **data**, for the same reason the workflow does on the backend: one table to
 * read when asking "why can this user see that?", instead of conditionals
 * spread through the layout. `AppShell` renders whatever this returns and
 * decides nothing itself.
 *
 * This is presentation, not permission. Hiding a link is a courtesy; the API
 * refuses the request either way.
 */
/**
 * A Material UI icon component.
 *
 * `@mui/icons-material` declares `SvgIconComponent` but does not export it,
 * so the shape is named here rather than imported.
 */
export type NavIcon = ComponentType<SvgIconProps>;

export interface NavItem {
  label: string;
  path: string;
  icon: NavIcon;
}

/** The "Report an issue" call to action. Every role may report. */
export const reportNavItem: NavItem = {
  label: 'Report an issue',
  path: paths.report,
  icon: AddCircleOutlinedIcon,
};

/** Return the navigation for a user, in the order it should be shown. */
export function navItemsFor(user: CurrentUser): NavItem[] {
  if (user.role === 'FACILITY_ADMIN') {
    return adminNavItems();
  }
  if (user.role === 'ENGINEER') {
    return engineerNavItems(user.engineer_profile?.level);
  }
  return employeeNavItems();
}

/** Employee: their own tickets, plus everyone's for checking duplicates. */
function employeeNavItems(): NavItem[] {
  return [
    { label: 'Home', path: paths.home, icon: HomeIcon },
    { label: 'My tickets', path: paths.myTickets, icon: ConfirmationNumberIcon },
    { label: 'All tickets', path: paths.allTickets, icon: ListAltIcon },
  ];
}

/**
 * Engineer: queue always; Unassigned for SENIOR and LEAD, who may pick work
 * up; Team for LEAD, who may assign it to others.
 */
function engineerNavItems(level: EngineerLevel | undefined): NavItem[] {
  const items: NavItem[] = [
    { label: 'Home', path: paths.home, icon: HomeIcon },
    { label: 'My queue', path: paths.myQueue, icon: AssignmentIndIcon },
  ];

  if (level === 'SENIOR' || level === 'LEAD') {
    items.push({ label: 'Unassigned', path: paths.unassigned, icon: InboxIcon });
  }

  items.push({ label: 'All tickets', path: paths.allTickets, icon: ListAltIcon });

  if (level === 'LEAD') {
    items.push({ label: 'Team', path: paths.team, icon: GroupsIcon });
  }

  return items;
}

/** Facility admin: the dashboard and the four things only they maintain. */
function adminNavItems(): NavItem[] {
  return [
    { label: 'Dashboard', path: paths.home, icon: DashboardIcon },
    { label: 'Tickets', path: paths.allTickets, icon: ConfirmationNumberIcon },
    { label: 'Engineers', path: paths.engineers, icon: EngineeringIcon },
    { label: 'Facilities', path: paths.facilities, icon: ApartmentIcon },
    { label: 'Categories', path: paths.categories, icon: CategoryIcon },
    { label: 'Users', path: paths.users, icon: ManageAccountsIcon },
  ];
}

/**
 * Pick the navigation item the current URL belongs to.
 *
 * Longest prefix wins, so `/tickets/mine` matches "My tickets" rather than
 * "All tickets" at `/tickets`. The home path is matched exactly, because every
 * URL starts with `/`.
 *
 * Two callers want two different halves of the answer: the shell highlights a
 * path, and `features/incidents/backTarget.ts` names a screen. They share this
 * function so that "which screen am I on?" is decided once.
 */
export function activeNavItem(pathname: string, items: NavItem[]): NavItem | undefined {
  const matches = items
    .filter((item) =>
      item.path === paths.home ? pathname === paths.home : pathname.startsWith(item.path),
    )
    .sort((a, b) => b.path.length - a.path.length);

  return matches[0];
}

/** The path of the navigation item the current URL belongs to. */
export function activeNavPath(pathname: string, items: NavItem[]): string | false {
  return activeNavItem(pathname, items)?.path ?? false;
}
