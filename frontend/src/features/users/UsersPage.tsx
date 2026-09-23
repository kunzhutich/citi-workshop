import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import SearchIcon from '@mui/icons-material/Search';
import { useState } from 'react';

import { describeError } from '../../api/errors';
import type { User, UserRole } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { FilterRow } from '../../components/FilterRow';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState, QueryState } from '../../components/QueryState';
import { useSnackbar } from '../../components/SnackbarContext';
import { roleLabel } from '../../layout/roleLabels';
import { formatDate } from '../../display/time';
import { useUpdateUser, useUsers } from './hooks';

/** Roles an admin may move an account between. */
const ROLES: UserRole[] = ['EMPLOYEE', 'ENGINEER', 'FACILITY_ADMIN'];

/**
 * Everyone with an account, their role, and whether it is still active.
 *
 * Two controls per row and no more, because two is all the API offers: role
 * and active. Email is the sign-in identity and the key every audit trail is
 * read by, so changing it would be an account migration; a password can only
 * be set by its owner.
 *
 * An admin cannot change their own role or deactivate themselves here. The API
 * refuses both — locking the last admin out of the system is the failure mode
 * that has no recovery path from inside the application — and the screen
 * disables the controls rather than letting someone discover it by being
 * refused.
 */
export function UsersPage() {
  const { user: currentUser } = useAuth();
  const { notify } = useSnackbar();
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);

  const users = useUsers({ q: search || undefined, include_inactive: includeInactive, page_size: 100 });
  const updateUser = useUpdateUser();

  const change = async (target: User, payload: { role?: UserRole; is_active?: boolean }) => {
    try {
      await updateUser.mutateAsync({ id: target.id, payload });
      notify(`${target.full_name} updated.`);
    } catch (error) {
      notify(describeError(error, 'Could not update that account.').message, 'error');
    }
  };

  return (
    <Box>
      <PageHeader title="Users" description="Every account, its role, and whether it can sign in." />

      <FilterRow sx={{ mb: 3 }}>
        <TextField
          label="Search"
          size="small"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Name or email"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <FormControlLabel
          control={
            <Switch
              checked={includeInactive}
              onChange={(event) => setIncludeInactive(event.target.checked)}
            />
          }
          label="Show deactivated accounts"
        />
      </FilterRow>

      <QueryState
        isPending={users.isPending}
        error={users.error}
        errorFallback="Could not load the accounts."
      >
        {(users.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="No accounts match" description="Try a different search." />
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small" aria-label="Users">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Joined</TableCell>
                  <TableCell align="right">Active</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(users.data?.items ?? []).map((row) => {
                  const isSelf = row.id === currentUser?.id;
                  return (
                    <TableRow key={row.id} hover>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2">{row.full_name}</Typography>
                          {isSelf ? <Chip size="small" label="You" /> : null}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {row.email}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <TextField
                          select
                          size="small"
                          value={row.role}
                          disabled={isSelf || updateUser.isPending}
                          onChange={(event) =>
                            void change(row, { role: event.target.value as UserRole })
                          }
                          sx={{ minWidth: 160 }}
                          slotProps={{ input: { 'aria-label': `Role for ${row.full_name}` } }}
                        >
                          {ROLES.map((option) => (
                            <MenuItem key={option} value={option}>
                              {roleLabel(option)}
                            </MenuItem>
                          ))}
                        </TextField>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{formatDate(row.created_at)}</Typography>
                      </TableCell>
                      <TableCell align="right">
                        {row.is_active ? (
                          <Button
                            size="small"
                            color="warning"
                            disabled={isSelf || updateUser.isPending}
                            onClick={() => void change(row, { is_active: false })}
                          >
                            Deactivate
                          </Button>
                        ) : (
                          <Button
                            size="small"
                            disabled={updateUser.isPending}
                            onClick={() => void change(row, { is_active: true })}
                          >
                            Reactivate
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </QueryState>
    </Box>
  );
}
