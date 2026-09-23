import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { useState } from 'react';

import type { EngineerCreatePayload, EngineerUpdatePayload } from '../../api/engineers';
import { describeError } from '../../api/errors';
import type { AvailabilityStatus, Engineer, EngineerLevel } from '../../api/types';
import { ResponsiveDialog } from '../../components/ResponsiveDialog';
import { levelLabel } from '../../layout/roleLabels';
import { AVAILABILITY_STATUSES, availabilityLabel } from '../../display/labels';
import { useCategoryTree } from '../categories/hooks';
import { useFacilityTree } from '../facilities/hooks';

/** The three levels, least to most authority. */
const LEVELS: EngineerLevel[] = ['JUNIOR', 'SENIOR', 'LEAD'];

export interface EngineerDialogProps {
  open: boolean;
  onClose: () => void;
  /** The engineer being edited, or null when creating one. */
  engineer: Engineer | null;
  onCreate: (payload: EngineerCreatePayload) => Promise<unknown>;
  onUpdate: (payload: EngineerUpdatePayload) => Promise<unknown>;
  isSubmitting: boolean;
}

/**
 * Add an engineer, or change one.
 *
 * There is no password field on either path. Creating an engineer generates a
 * temporary password the API returns **once**, which the caller then shows;
 * editing one cannot set a password at all. A password an engineer will keep
 * should never travel through an admin's screen or a support chat.
 *
 * Email is create-only for the same reason it is absent from `UserUpdate`: it
 * is the sign-in identity and the key the audit trail is read by.
 */
export function EngineerDialog({
  open,
  onClose,
  engineer,
  onCreate,
  onUpdate,
  isSubmitting,
}: EngineerDialogProps) {
  const categories = useCategoryTree();
  const facilities = useFacilityTree();

  const [email, setEmail] = useState(engineer?.email ?? '');
  const [fullName, setFullName] = useState(engineer?.full_name ?? '');
  const [level, setLevel] = useState<EngineerLevel>(engineer?.level ?? 'JUNIOR');
  const [specialties, setSpecialties] = useState<string[]>(engineer?.specialty_group_ids ?? []);
  const [homeBuildingId, setHomeBuildingId] = useState(engineer?.home_building_id ?? '');
  const [phone, setPhone] = useState(engineer?.phone ?? '');
  const [maxActive, setMaxActive] = useState(String(engineer?.max_active_tickets ?? 10));
  const [availability, setAvailability] = useState<AvailabilityStatus>(
    engineer?.availability ?? 'AVAILABLE',
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async () => {
    setFormError(null);
    setFieldErrors({});

    try {
      if (engineer) {
        await onUpdate({
          full_name: fullName.trim(),
          level,
          specialty_group_ids: specialties,
          home_building_id: homeBuildingId || null,
          phone: phone.trim() || null,
          availability,
          max_active_tickets: Number(maxActive) || 1,
        });
      } else {
        await onCreate({
          email: email.trim(),
          full_name: fullName.trim(),
          level,
          specialty_group_ids: specialties,
          home_building_id: homeBuildingId || null,
          phone: phone.trim() || null,
          max_active_tickets: Number(maxActive) || 1,
        });
      }
      onClose();
    } catch (error) {
      const described = describeError(error, 'Could not save this engineer.');
      setFieldErrors(described.fieldErrors);
      setFormError(described.message);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      title={engineer ? `Edit ${engineer.full_name}` : 'Add an engineer'}
    >
      <DialogContent dividers>
        <Box sx={{ display: 'grid', gap: 2 }}>
          {engineer ? null : (
            <TextField
              required
              autoFocus
              label="Email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@acme.inc"
              error={Boolean(fieldErrors.email)}
              helperText={fieldErrors.email ?? 'An @acme.inc address. It cannot be changed later.'}
            />
          )}

          <TextField
            required
            label="Full name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            error={Boolean(fieldErrors.full_name)}
            helperText={fieldErrors.full_name}
          />

          <TextField
            select
            label="Level"
            value={level}
            onChange={(event) => setLevel(event.target.value as EngineerLevel)}
            error={Boolean(fieldErrors.level)}
            helperText={
              fieldErrors.level ??
              'Junior is given work; senior may pick tickets up; lead may assign anyone.'
            }
          >
            {LEVELS.map((option) => (
              <MenuItem key={option} value={option}>
                {levelLabel(option)}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="Specialties"
            value={specialties}
            onChange={(event) =>
              setSpecialties(
                typeof event.target.value === 'string'
                  ? event.target.value.split(',').filter(Boolean)
                  : event.target.value,
              )
            }
            helperText="The category groups this engineer handles. A group covers its subcategories."
            slotProps={{
              select: {
                multiple: true,
                renderValue: (selected) => {
                  const ids = selected as string[];
                  const names = (categories.data?.groups ?? [])
                    .filter((group) => ids.includes(group.id))
                    .map((group) => group.name);
                  return names.join(', ') || 'None';
                },
                displayEmpty: true,
              },
            }}
          >
            {(categories.data?.groups ?? []).map((group) => (
              <MenuItem key={group.id} value={group.id}>
                <Checkbox size="small" checked={specialties.includes(group.id)} />
                <ListItemText primary={group.name} />
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="Home building"
            value={homeBuildingId}
            onChange={(event) => setHomeBuildingId(event.target.value)}
          >
            <MenuItem value="">No home building</MenuItem>
            {(facilities.data?.buildings ?? []).map((building) => (
              <MenuItem key={building.id} value={building.id}>
                {building.code} — {building.name}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="Phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            error={Boolean(fieldErrors.phone)}
            helperText={fieldErrors.phone}
          />

          <TextField
            label="Maximum active tickets"
            type="number"
            value={maxActive}
            onChange={(event) => setMaxActive(event.target.value)}
            error={Boolean(fieldErrors.max_active_tickets)}
            helperText={
              fieldErrors.max_active_tickets ??
              'A soft limit: assigning past it warns rather than refuses.'
            }
          />

          {engineer ? (
            <TextField
              select
              label="Availability"
              value={availability}
              onChange={(event) => setAvailability(event.target.value as AvailabilityStatus)}
            >
              {AVAILABILITY_STATUSES.map((option) => (
                <MenuItem key={option} value={option}>
                  {availabilityLabel(option)}
                </MenuItem>
              ))}
            </TextField>
          ) : null}

          {formError ? <Alert severity="error">{formError}</Alert> : null}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => void submit()}
          loading={isSubmitting}
          disabled={fullName.trim() === '' || (!engineer && email.trim() === '')}
        >
          {engineer ? 'Save' : 'Create engineer'}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
