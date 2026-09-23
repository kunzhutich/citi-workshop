import LockResetIcon from '@mui/icons-material/LockReset';
import LogoutIcon from '@mui/icons-material/Logout';
import Avatar from '@mui/material/Avatar';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { CurrentUser } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { paths } from '../routes';
import { describeRole } from './roleLabels';

/**
 * Avatar menu in the top bar: who you are, change password, log out.
 *
 * Signing out navigates rather than waiting for a guard to bounce the user:
 * the request is already gone, and the login screen should appear at once.
 */
export function UserMenu({ user }: { user: CurrentUser }) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const close = () => setAnchor(null);

  async function handleSignOut(): Promise<void> {
    close();
    await signOut();
    void navigate(paths.login, { replace: true });
  }

  return (
    <>
      <Tooltip title="Account">
        <IconButton
          onClick={(event) => setAnchor(event.currentTarget)}
          size="small"
          aria-label={`Account menu for ${user.full_name}`}
          aria-haspopup="menu"
        >
          <Avatar sx={{ width: 34, height: 34, bgcolor: 'secondary.main', fontSize: 15 }}>
            {initialsOf(user.full_name)}
          </Avatar>
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 240 } } }}
      >
        <MenuItem disabled sx={{ opacity: '1 !important', display: 'block' }}>
          <Typography variant="subtitle2">{user.full_name}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {user.email}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {describeRole(user)}
          </Typography>
        </MenuItem>

        <Divider />

        <MenuItem
          onClick={() => {
            close();
            void navigate(paths.changePassword);
          }}
        >
          <ListItemIcon>
            <LockResetIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Change password</ListItemText>
        </MenuItem>

        <MenuItem onClick={() => void handleSignOut()}>
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Log out</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}

/** Build up to two initials from a full name, for the avatar. */
function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}
