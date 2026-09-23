import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { useState } from 'react';

import { describeError } from '../api/errors';
import type { AvailabilityStatus, CurrentUser } from '../api/types';
import { useSnackbar } from '../components/SnackbarContext';
import { useUpdateOwnProfile } from '../features/engineers/hooks';
import { AVAILABILITY_STATUSES, availabilityLabel } from '../display/labels';

export interface AvailabilityToggleProps {
  user: CurrentUser;
}

/**
 * An engineer's own availability, in the top bar.
 *
 * In the bar rather than on a settings page because it is the one thing an
 * engineer changes several times a day, and because it is what the assign
 * dialog shows to everyone deciding who to give work to. A setting other
 * people read should be one people can change without going looking for it.
 *
 * It is optimistic in appearance only: the select shows the new value while
 * the request is in flight and reverts if it fails, because the alternative —
 * a control that does nothing for 300ms — reads as broken.
 */
export function AvailabilityToggle({ user }: AvailabilityToggleProps) {
  const { notify } = useSnackbar();
  const updateProfile = useUpdateOwnProfile();
  const [pending, setPending] = useState<AvailabilityStatus | null>(null);

  const current = pending ?? user.engineer_profile?.availability ?? 'AVAILABLE';

  const change = async (availability: AvailabilityStatus) => {
    setPending(availability);
    try {
      await updateProfile.mutateAsync({ availability });
      notify(`You are now ${availabilityLabel(availability).toLowerCase()}.`);
    } catch (error) {
      setPending(null);
      notify(describeError(error, 'Could not change your availability.').message, 'error');
    }
  };

  return (
    <Box sx={{ mr: 1 }}>
      <Select
        value={current}
        onChange={(event) => void change(event.target.value as AvailabilityStatus)}
        size="small"
        disabled={updateProfile.isPending}
        inputProps={{ 'aria-label': 'Your availability' }}
        sx={(theme) => ({
          color: theme.palette.primary.contrastText,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255, 255, 255, 0.3)' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255, 255, 255, 0.5)' },
          '& .MuiSelect-icon': { color: theme.palette.primary.contrastText },
        })}
      >
        {AVAILABILITY_STATUSES.map((option) => (
          <MenuItem key={option} value={option}>
            {availabilityLabel(option)}
          </MenuItem>
        ))}
      </Select>
    </Box>
  );
}
