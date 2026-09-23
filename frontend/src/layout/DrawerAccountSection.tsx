import LockResetIcon from '@mui/icons-material/LockReset';
import LogoutIcon from '@mui/icons-material/Logout';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useNavigate } from 'react-router-dom';

import type { CurrentUser } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { paths } from '../routes';
import { describeRole, initialsOf } from './roleLabels';

export interface DrawerAccountSectionProps {
  user: CurrentUser;
  /** Close the drawer. Called before navigating away from it. */
  onNavigate: () => void;
}

/**
 * Who you are and what you can do about it, at the foot of the mobile drawer.
 *
 * On a phone the top bar carries no avatar — the reachable corner is spent on
 * the drawer button instead — so this is the only place the account lives.
 * It sits below the work navigation, behind a `Divider`, because "which
 * tickets am I looking at" and "who am I signed in as" are different questions
 * and mixing them into one list makes both harder to scan.
 *
 * Desktop does not render this: there the avatar menu in the top bar already
 * holds the same three things.
 */
export function DrawerAccountSection({ user, onNavigate }: DrawerAccountSectionProps) {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut(): Promise<void> {
    onNavigate();
    await signOut();
    void navigate(paths.login, { replace: true });
  }

  return (
    <Box component="section" aria-label="Account">
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', px: 2, py: 1.5 }}>
        <Avatar sx={{ width: 36, height: 36, bgcolor: 'secondary.main', fontSize: 15 }}>
          {initialsOf(user.full_name)}
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap>
            {user.full_name}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
            {user.email}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {describeRole(user)}
          </Typography>
        </Box>
      </Stack>

      {/* `ListItem` wrappers: a `ListItemButton` is a `<button>` or an `<a>`,
          and neither is a legal direct child of the `<ul>` a `List` renders. */}
      <List disablePadding sx={{ px: 1.5, pb: 1.5 }}>
        <ListItem disablePadding sx={{ display: 'block' }}>
          <ListItemButton
            onClick={() => {
              onNavigate();
              void navigate(paths.changePassword);
            }}
            sx={{ borderRadius: 1.5 }}
          >
            <ListItemIcon sx={{ minWidth: 40 }}>
              <LockResetIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Change password" />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding sx={{ display: 'block' }}>
          <ListItemButton onClick={() => void handleSignOut()} sx={{ borderRadius: 1.5 }}>
            <ListItemIcon sx={{ minWidth: 40 }}>
              <LogoutIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Log out" />
          </ListItemButton>
        </ListItem>
      </List>
    </Box>
  );
}
