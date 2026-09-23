import AddIcon from '@mui/icons-material/Add';
import MenuIcon from '@mui/icons-material/Menu';
import AppBar from '@mui/material/AppBar';
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
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { Link as RouterLink, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { SkipLink } from '../components/SkipLink';
import { NotificationBell } from '../features/notifications/NotificationBell';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { paths } from '../routes';
import { AvailabilityToggle } from './AvailabilityToggle';
import { DrawerAccountSection } from './DrawerAccountSection';
import { activeNavPath, navItemsFor, reportNavItem } from './navigation';
import { TicketSearchField } from './TicketSearchField';
import { UserMenu } from './UserMenu';

/** Width of the permanent desktop drawer, in pixels. */
const DRAWER_WIDTH = 248;

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
 * changes at 900 px is the navigation *surface* — a permanent drawer on the
 * left on desktop, a temporary one from the right on a phone — while the app
 * bar, the account menu and the content slot stay the same.
 *
 * **There is one mobile navigation surface, not two.** A bottom bar used to
 * carry three or four of these items as well, and the redesign brief removed
 * it: the drawer covers the same ground and then some, and the bar spent 56px
 * of a phone's height repeating a subset of what the menu button already
 * opened. Deleted rather than hidden, so nothing has to reserve room for it.
 *
 * **The phone's drawer opens from the right.** M5 put the menu button in the
 * right corner for thumb reach and left the panel opening from the left, so
 * the tap and the thing it produced were at opposite edges. The desktop drawer
 * stays on the left: it is permanent, it is never "opened", and reach is not a
 * constraint with a mouse.
 *
 * **Landmarks.** `AppBar` is a `<header>`, the navigation surface is a real
 * `<nav>`, and the content slot is `<main>`. The `<nav>` keeps its "Main"
 * label even now that it is the only one, because a page snapshot that says
 * which surface it is costs one attribute.
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
            The trailing controls, and which ones depend on the width. On a
            phone it is the bell and the drawer button: the drawer is what
            people reach for most, so it keeps the far corner where a right
            thumb lands, and the bell goes beside it because an unread badge
            hidden behind a tap is not a badge at all. The account lives at the
            foot of the drawer instead. On desktop,
            where reach is not a constraint, the avatar menu keeps its
            conventional corner.

            The search box and the availability select are desktop-only for
            the same reason the bottom bar exists: a 375px app bar fits a
            title and one control. On a phone, search lives inside each list's
            filter drawer, where it is one tap from the tickets it filters.
          */}
          {isMobile ? (
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              {/* The bell is the one control that earns a place beside the
                  menu button on a 375px bar. A badge is worthless behind a
                  tap: the whole point of it is being seen without looking. */}
              <NotificationBell />
              <IconButton
                edge="end"
                color="inherit"
                aria-label="Open navigation"
                onClick={() => setDrawerOpen(true)}
              >
                <MenuIcon />
              </IconButton>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <TicketSearchField />
              {user.role === 'ENGINEER' ? <AvailabilityToggle user={user} /> : null}
              <NotificationBell />
              <UserMenu user={user} />
            </Box>
          )}
        </Toolbar>
      </AppBar>

      {isMobile ? (
        <Drawer
          anchor="right"
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
          pb: 3,
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

      {/* Not on the report page itself, where it links to where you already
          are and covers a card while doing it. It sits at the bottom corner
          the navigation bar used to occupy — with the bar gone there is
          nothing under it to clear. */}
      {isMobile && user.role === 'EMPLOYEE' && location.pathname !== reportNavItem.path ? (
        <Fab
          color="primary"
          aria-label={reportNavItem.label}
          component={RouterLink}
          to={reportNavItem.path}
          sx={{ position: 'fixed', right: 16, bottom: 16 }}
        >
          <AddIcon />
        </Fab>
      ) : null}
    </Box>
  );
}
