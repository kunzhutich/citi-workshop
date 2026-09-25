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

import type { EngineerCreatePayload } from '../../api/engineers';
import { describeError } from '../../api/errors';
import type { EngineerLevel } from '../../api/types';
import { ResponsiveDialog } from '../../components/ResponsiveDialog';
import { levelLabel } from '../../layout/roleLabels';
import { useCategoryTree } from '../categories/hooks';
import { useFacilityTree } from '../facilities/hooks';

/** The three levels, least to most authority. */
const LEVELS: EngineerLevel[] = ['JUNIOR', 'SENIOR', 'LEAD'];

export interface EngineerDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (payload: EngineerCreatePayload) => Promise<unknown>;
  isSubmitting: boolean;
}

/**
 * Add an engineer.
 *
 * **Creating only, since R7.** This used to be a dual-mode dialog: pass an
 * engineer and it edited one, pass null and it created one. §6.1 moved every
 * editable field onto the engineer's own page as `EngineerBasics`, R7 removed
 * the roster's Edit button that was the only way into the other mode, and what
 * was left was a second branch through every field that nothing could reach —
 * plus an `onUpdate` its one caller had to satisfy with a resolved promise.
 *
 * A dialog is the right shape for creating and the wrong shape for editing,
 * which is [D59](../../../../readme/DECISION-LOG.md)'s point: you fill this in
 * once, you get a temporary password, you are done. Editing is a question
 * about a person you are looking at, and a modal cannot show you the person.
 *
 * There is no password field. Creating an engineer generates a temporary
 * password the API returns **once**, which the caller then shows. A password
 * an engineer will keep should never travel through an admin's screen or a
 * support chat.
 *
 * Email is here and nowhere else for the same reason it is absent from
 * `UserUpdate`: it is the sign-in identity and the key the audit trail is read
 * by. Availability is the opposite case — it is absent here because it is the
 * engineer's own statement about themselves, and a new account starts
 * available.
 */
export function EngineerDialog({ open, onClose, onCreate, isSubmitting }: EngineerDialogProps) {
  const categories = useCategoryTree();
  const facilities = useFacilityTree();

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [level, setLevel] = useState<EngineerLevel>('JUNIOR');
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [homeBuildingId, setHomeBuildingId] = useState('');
  const [phone, setPhone] = useState('');
  const [maxActive, setMaxActive] = useState('10');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async () => {
    setFormError(null);
    setFieldErrors({});

    try {
      await onCreate({
        email: email.trim(),
        full_name: fullName.trim(),
        level,
        specialty_group_ids: specialties,
        home_building_id: homeBuildingId || null,
        phone: phone.trim() || null,
        max_active_tickets: Number(maxActive) || 1,
      });
      onClose();
    } catch (error) {
      const described = describeError(error, 'Could not save this engineer.');
      setFieldErrors(described.fieldErrors);
      setFormError(described.message);
    }
  };

  return (
    <ResponsiveDialog open={open} onClose={onClose} title="Add an engineer">
      <DialogContent dividers>
        <Box sx={{ display: 'grid', gap: 2 }}>
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
              // `displayEmpty` draws "None" inside the field before anything
              // is chosen, and an unshrunk label is drawn in the same place —
              // the two overlapped into one unreadable word on first open.
              // Pinning the label up is what the ticket list's status and
              // priority filters already do; this is the same fix, and the
              // same comment is in `IncidentFilterBar`. §6.2.
              inputLabel: { shrink: true },
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

          {formError ? <Alert severity="error">{formError}</Alert> : null}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => void submit()}
          loading={isSubmitting}
          disabled={fullName.trim() === '' || email.trim() === ''}
        >
          Create engineer
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
