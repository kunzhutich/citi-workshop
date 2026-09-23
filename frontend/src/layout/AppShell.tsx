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
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { Link as RouterLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { paths } from '../routes';
import { DrawerAccountSection } from './DrawerAccountSection';
import { activeNavPath, navItemsFor, reportNavItem } from './navigation';
import { UserMenu } from './UserMenu';

/** Width of the permanent desktop drawer, in pixels. */
const DRAWER_WIDTH = 248;

/** Height reserved under the content for the mobile bottom bar, in pixels. */
const BOTTOM_NAV_HEIGHT = 56;

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
 */
export function AppShell() {
  const { user } = useAuth();
  const { isMobile } = useBreakpoint();
  const location = useLocation();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // `RequireAuth` renders this only with a user; the check keeps the types
  // honest rather than guarding against a real case.
  if (!user) {
    return null;
  }

  const items = navItemsFor(user);
  const activePath = activeNavPath(location.pathname, [...items, reportNavItem]);
  const bottomItems = items.filter((item) => item.inBottomNav);

  const workNavigation = (
    <Box sx={{ px: 1.5, py: 2 }} role="navigation" aria-label="Main">
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
      <List disablePadding>
        {items.map((item) => (
          <ListItemButton
            key={item.path}
            component={RouterLink}
            to={item.path}
            selected={item.path === activePath}
            onClick={() => setDrawerOpen(false)}
            sx={{ borderRadius: 1.5, mb: 0.5 }}
          >
            <ListItemIcon sx={{ minWidth: 40 }}>
              <item.icon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary={item.label} />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh', bgcolor: 'background.default' }}>
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
            <UserMenu user={user} />
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
            <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>{workNavigation}</Box>
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
          {workNavigation}
        </Drawer>
      )}

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          px: { xs: 2, md: 3 },
          py: { xs: 2, md: 3 },
          // Clear the fixed bottom bar so the last row is never under it.
          pb: isMobile ? `${BOTTOM_NAV_HEIGHT + 24}px` : 3,
        }}
      >
        <Toolbar />
        <Outlet />
      </Box>

      {isMobile ? (
        <>
          {user.role === 'EMPLOYEE' ? (
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
            elevation={3}
            sx={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1200 }}
          >
            <BottomNavigation
              value={activePath}
              onChange={(_event, path: string) => void navigate(path)}
              showLabels
            >
              {bottomItems.map((item) => (
                <BottomNavigationAction
                  key={item.path}
                  label={item.label}
                  value={item.path}
                  icon={<item.icon />}
                />
              ))}
            </BottomNavigation>
          </Paper>
        </>
      ) : null}
    </Box>
  );
}
