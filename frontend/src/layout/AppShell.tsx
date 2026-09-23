import AddIcon from '@mui/icons-material/Add';
import MenuIcon from '@mui/icons-material/Menu';
import AppBar from '@mui/material/AppBar';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import Fab from '@mui/material/Fab';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { Link as RouterLink, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { SkipLink } from '../components/SkipLink';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { paths } from '../routes';
import { AvailabilityToggle } from './AvailabilityToggle';
import { DrawerAccountSection } from './DrawerAccountSection';
import { activeNavPath, navItemsFor, reportNavItem } from './navigation';
import { TicketSearchField } from './TicketSearchField';
import { UserMenu } from './UserMenu';

/** Width of the permanent desktop drawer, in pixels. */
const DRAWER_WIDTH = 248;

/** Height reserved under the content for the mobile bottom bar, in pixels. */
const BOTTOM_NAV_HEIGHT = 56;

/**
 * The id the skip link jumps to, and the `<main>` landmark's own id.
 *
 * Named once because three things have to agree on it: the anchor's `href`,
 * the element's `id`, and the focus target. A typo in any of them produces a
 * link that looks right and goes nowhere.
 */
export const MAIN_CONTENT_ID = 'main-content';

/**
 * The application frame every signed-in screen renders inside.
 *
 * One component serves both layouts rather than two that drift apart. What
 * changes at 900 px is the navigation *surface* — a permanent left drawer on
 * desktop, a bottom bar plus a temporary drawer on mobile — while the app bar,
 * the account menu and the content slot stay the same.
 *
 * The bottom bar holds the three or four items `navigation.ts` marks for it.
 * The menu button opens the full list, so an admin's Categories and Users
 * pages are one tap away on a phone instead of unreachable.
 *
 * **Landmarks.** `AppBar` is a `<header>`, the navigation surfaces are real
 * `<nav>` elements, and the content slot is `<main>`. Each `<nav>` carries its
 * own label, because on a phone two of them can be on screen at once and "two
 * navigations" is not a thing a screen-reader user can choose between. The
 * skip link is the first focusable element on the page, which is what makes
 * the sidebar's six links skippable rather than six presses of Tab on every
 * single screen.
 */
export function AppShell() {
  const { user } = useAuth();
  const { isMobile } = useBreakpoint();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // `RequireAuth` renders this only with a user; the check keeps the types
  // honest rather than guarding against a real case.
  if (!user) {
    return null;
  }

  const items = navItemsFor(user);
  const activePath = activeNavPath(location.pathname, [...items, reportNavItem]);
  const bottomItems = items.filter((item) => item.inBottomNav);

  const workNavigation = (label: string) => (
    <Box component="nav" aria-label={label} sx={{ px: 1.5, py: 2 }}>
      <Button
        component={RouterLink}
        to={reportNavItem.path}
        onClick={() => setDrawerOpen(false)}
        variant="contained"
        fullWidth
        startIcon={<AddIcon />}
        sx={{ mb: 2 }}
      >
        {reportNavItem.label}
      </Button>
      <Divider sx={{ mb: 1 }} />
      {/*
        `ListItem` wrappers are not decoration. A `ListItemButton` rendered as
        a router link is an `<a>`, and an `<a>` as a direct child of a `<ul>`
        is invalid — axe flags it as a serious `list` violation, and a screen
        reader may not announce the list or its item count at all. The
        `<li>` is what makes "6 items, item 2 of 6" possible.
      */}
      <List disablePadding>
        {items.map((item) => (
          <ListItem key={item.path} disablePadding sx={{ display: 'block' }}>
            <ListItemButton
              component={RouterLink}
              to={item.path}
              selected={item.path === activePath}
              // `selected` is styling; this is the fact. Without it the
              // current page is signalled by a background colour alone, which
              // is exactly the channel a screen reader does not have.
              aria-current={item.path === activePath ? 'page' : undefined}
              onClick={() => setDrawerOpen(false)}
              sx={{ borderRadius: 1.5, mb: 0.5 }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                <item.icon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh', bgcolor: 'background.default' }}>
      <SkipLink targetId={MAIN_CONTENT_ID} />

      <AppBar
        position="fixed"
        elevation={0}
        sx={(theme) => ({
          zIndex: theme.zIndex.drawer + 1,
          borderBottom: `1px solid ${theme.palette.divider}`,
        })}
      >
        <Toolbar>
          <Typography
            variant="h6"
            component={RouterLink}
            to={paths.home}
            sx={{ color: 'inherit', textDecoration: 'none', fontWeight: 600 }}
          >
            ACME Facilities
          </Typography>

          <Box sx={{ flexGrow: 1 }} />

          {/*
            One trailing control, and which one depends on the width. On a
            phone it is the drawer button: it is the control people reach for
            most, and the right side of the bar is where a right thumb lands.
            The account lives at the foot of the drawer instead. On desktop,
            where reach is not a constraint, the avatar menu keeps its
            conventional corner.

            The search box and the availability select are desktop-only for
            the same reason the bottom bar exists: a 375px app bar fits a
            title and one control. On a phone, search lives inside each list's
            filter drawer, where it is one tap from the tickets it filters.
          */}
          {isMobile ? (
            <IconButton
              edge="end"
              color="inherit"
              aria-label="Open navigation"
              onClick={() => setDrawerOpen(true)}
            >
              <MenuIcon />
            </IconButton>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <TicketSearchField />
              {user.role === 'ENGINEER' ? <AvailabilityToggle user={user} /> : null}
              <UserMenu user={user} />
            </Box>
          )}
        </Toolbar>
      </AppBar>

      {isMobile ? (
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          slotProps={{ paper: { sx: { width: DRAWER_WIDTH } } }}
        >
          <Toolbar />
          <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
            {/* Work above, account below, and the work list is the half that
                scrolls — so the account never drifts off the bottom of a long
                navigation, and never gets read as another place to go. */}
            <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>{workNavigation('Main')}</Box>
            <Divider />
            <DrawerAccountSection user={user} onNavigate={() => setDrawerOpen(false)} />
          </Box>
        </Drawer>
      ) : (
        <Drawer
          variant="permanent"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' },
          }}
        >
          <Toolbar />
          {/* No account section here: the desktop top bar still has the avatar
              menu, and duplicating it would give one action two homes. */}
          {workNavigation('Main')}
        </Drawer>
      )}

      <Box
        component="main"
        id={MAIN_CONTENT_ID}
        // Focusable only by script, so the skip link can actually move focus
        // here. Without it the browser scrolls to the element and leaves focus
        // back on the link, and the next Tab returns to the navigation the
        // user just asked to skip.
        tabIndex={-1}
        sx={{
          flexGrow: 1,
          minWidth: 0,
          px: { xs: 2, md: 3 },
          py: { xs: 2, md: 3 },
          // Clear the fixed bottom bar so the last row is never under it.
          pb: isMobile ? `${BOTTOM_NAV_HEIGHT + 24}px` : 3,
          // It is a focus target rather than a control, so the ring it would
          // otherwise draw around the whole page is noise.
          outline: 'none',
        }}
      >
        <Toolbar />
        {/*
          Keyed on the pathname so that navigating away clears a caught error.
          Without the key the fallback would stay on screen after the user went
          somewhere that works, and the only way out would be a reload.

          Inside the shell rather than around it, so the navigation survives a
          screen that throws — which is the whole difference between "this page
          is broken" and "the application is broken".
        */}
        <ErrorBoundary key={location.pathname} label={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </Box>

      {isMobile ? (
        <>
          {/* Not on the report page itself, where it links to where you
              already are and covers a card while doing it. */}
          {user.role === 'EMPLOYEE' && location.pathname !== reportNavItem.path ? (
            <Fab
              color="primary"
              aria-label={reportNavItem.label}
              component={RouterLink}
              to={reportNavItem.path}
              sx={{ position: 'fixed', right: 16, bottom: BOTTOM_NAV_HEIGHT + 16 }}
            >
              <AddIcon />
            </Fab>
          ) : null}

          <Paper
            component="nav"
            // A different name from the drawer's "Main", because on a phone
            // both can be on screen at once and "navigation, navigation" is
            // not a choice anybody can make. This one is the four-item subset
            // `navigation.ts` marks with `inBottomNav`; the drawer is all of
            // them.
            aria-label="Quick links"
            elevation={3}
            sx={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1200 }}
          >
            <BottomNavigation value={activePath} showLabels>
              {bottomItems.map((item) => (
                <BottomNavigationAction
                  key={item.path}
                  label={item.label}
                  value={item.path}
                  icon={<item.icon />}
                  // Real anchors rather than buttons driven by `onChange`.
                  // These go somewhere, so they should be links: a screen
                  // reader announces "link", the browser offers open-in-new-
                  // tab and middle-click, and the status bar shows where the
                  // tap will land. The previous version navigated
                  // imperatively, which worked and told the user nothing.
                  component={RouterLink}
                  to={item.path}
                  aria-current={item.path === activePath ? 'page' : undefined}
                />
              ))}
            </BottomNavigation>
          </Paper>
        </>
      ) : null}
    </Box>
  );
}
