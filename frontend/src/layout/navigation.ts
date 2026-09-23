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
  /**
   * Whether the item belongs in the mobile bottom bar.
   *
   * The bar holds three or four items. Everything else stays reachable on a
   * phone through the drawer behind the menu button, so no screen is hidden
   * by being fifth in the list.
   */
  inBottomNav: boolean;
}

/** The "Report an issue" call to action. Every role may report. */
export const reportNavItem: NavItem = {
  label: 'Report an issue',
  path: paths.report,
  icon: AddCircleOutlinedIcon,
  inBottomNav: false,
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
    { label: 'Home', path: paths.home, icon: HomeIcon, inBottomNav: true },
    { label: 'My tickets', path: paths.myTickets, icon: ConfirmationNumberIcon, inBottomNav: true },
    { label: 'All tickets', path: paths.allTickets, icon: ListAltIcon, inBottomNav: true },
  ];
}

/**
 * Engineer: queue always; Unassigned for SENIOR and LEAD, who may pick work
 * up; Team for LEAD, who may assign it to others.
 */
function engineerNavItems(level: EngineerLevel | undefined): NavItem[] {
  const items: NavItem[] = [
    { label: 'Home', path: paths.home, icon: HomeIcon, inBottomNav: true },
    { label: 'My queue', path: paths.myQueue, icon: AssignmentIndIcon, inBottomNav: true },
  ];

  if (level === 'SENIOR' || level === 'LEAD') {
    items.push({ label: 'Unassigned', path: paths.unassigned, icon: InboxIcon, inBottomNav: true });
  }

  items.push({ label: 'All tickets', path: paths.allTickets, icon: ListAltIcon, inBottomNav: true });

  if (level === 'LEAD') {
    items.push({ label: 'Team', path: paths.team, icon: GroupsIcon, inBottomNav: false });
  }

  return items;
}

/** Facility admin: the dashboard and the four things only they maintain. */
function adminNavItems(): NavItem[] {
  return [
    { label: 'Dashboard', path: paths.home, icon: DashboardIcon, inBottomNav: true },
    { label: 'Tickets', path: paths.allTickets, icon: ConfirmationNumberIcon, inBottomNav: true },
    { label: 'Engineers', path: paths.engineers, icon: EngineeringIcon, inBottomNav: true },
    { label: 'Facilities', path: paths.facilities, icon: ApartmentIcon, inBottomNav: true },
    { label: 'Categories', path: paths.categories, icon: CategoryIcon, inBottomNav: false },
    { label: 'Users', path: paths.users, icon: ManageAccountsIcon, inBottomNav: false },
  ];
}

/**
 * Pick the navigation item the current URL belongs to.
 *
 * Longest prefix wins, so `/tickets/mine` highlights "My tickets" rather than
 * "All tickets" at `/tickets`. The home path is matched exactly, because every
 * URL starts with `/`.
 */
export function activeNavPath(pathname: string, items: NavItem[]): string | false {
  const matches = items
    .filter((item) =>
      item.path === paths.home ? pathname === paths.home : pathname.startsWith(item.path),
    )
    .sort((a, b) => b.path.length - a.path.length);

  return matches[0]?.path ?? false;
}
