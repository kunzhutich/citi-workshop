import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import type { AvailabilityStatus, Engineer, EngineerLevel } from '../../api/types';
import { FilterRow } from '../../components/FilterRow';
import { useSnackbar } from '../../components/SnackbarContext';
import { availabilityLabel } from '../../display/labels';
import { levelLabel } from '../../layout/roleLabels';
import { useCategoryTree } from '../categories/hooks';
import { useFacilityTree } from '../facilities/hooks';
import { useUpdateEngineer } from './hooks';

const LEVELS: EngineerLevel[] = ['JUNIOR', 'SENIOR', 'LEAD'];
const AVAILABILITY: AvailabilityStatus[] = ['AVAILABLE', 'BUSY', 'ON_LEAVE'];

/**
 * An engineer's settings, edited where they are read.
 *
 * §6.1 asks for the basic information to be "editable in place", which is the
 * half of the old modal worth keeping. It is a form that is always a form —
 * there is no Edit button that turns labels into inputs, because a screen with
 * two modes has to tell you which one it is in, and this one has four fields.
 *
 * **Save is explicit.** Everything else this application does with a switch or
 * a select applies immediately, and this deliberately does not: changing
 * somebody's level or their ticket ceiling is a decision about a person, and
 * the kind of thing to be sure about before it takes effect. The button stays
 * disabled until something actually differs, so it is also the record of
 * whether there is anything to save.
 */
export interface EngineerBasicsProps {
  engineer: Engineer;
}

export function EngineerBasics({ engineer }: EngineerBasicsProps) {
  const { notify } = useSnackbar();
  const update = useUpdateEngineer();
  const categories = useCategoryTree();
  const facilities = useFacilityTree();

  const [fullName, setFullName] = useState(engineer.full_name);
  const [level, setLevel] = useState<EngineerLevel>(engineer.level);
  const [specialties, setSpecialties] = useState<string[]>(engineer.specialty_group_ids);
  const [homeBuildingId, setHomeBuildingId] = useState(engineer.home_building_id ?? '');
  const [phone, setPhone] = useState(engineer.phone ?? '');
  const [maxActive, setMaxActive] = useState(String(engineer.max_active_tickets));
  const [availability, setAvailability] = useState<AvailabilityStatus>(engineer.availability);

  const changed =
    fullName !== engineer.full_name ||
    level !== engineer.level ||
    specialties.join() !== engineer.specialty_group_ids.join() ||
    homeBuildingId !== (engineer.home_building_id ?? '') ||
    phone !== (engineer.phone ?? '') ||
    maxActive !== String(engineer.max_active_tickets) ||
    availability !== engineer.availability;

  const save = async () => {
    await update.mutateAsync({
      userId: engineer.user_id,
      payload: {
        full_name: fullName.trim(),
        level,
        specialty_group_ids: specialties,
        home_building_id: homeBuildingId || null,
        phone: phone.trim() || null,
        availability,
        max_active_tickets: Number(maxActive) || engineer.max_active_tickets,
      },
    });
    notify(`${fullName.trim()} updated.`);
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h3" component="h2" gutterBottom>
          Details
        </Typography>

        <FilterRow minColumn={220} sx={{ alignItems: 'start' }}>
          <TextField
            label="Full name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
          <TextField
            select
            label="Level"
            value={level}
            onChange={(event) => setLevel(event.target.value as EngineerLevel)}
          >
            {LEVELS.map((option) => (
              <MenuItem key={option} value={option}>
                {levelLabel(option)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Availability"
            value={availability}
            onChange={(event) => setAvailability(event.target.value as AvailabilityStatus)}
          >
            {AVAILABILITY.map((option) => (
              <MenuItem key={option} value={option}>
                {availabilityLabel(option)}
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
              // Same fix as the dialog and the ticket filters: `displayEmpty`
              // draws "None" where an unshrunk label also sits, and the two
              // overlap into one unreadable word. §6.2.
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
                {building.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
          <TextField
            label="Ticket ceiling"
            type="number"
            value={maxActive}
            onChange={(event) => setMaxActive(event.target.value)}
            helperText="A soft limit — assigning past it warns rather than refuses."
          />
        </FilterRow>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
          <Button
            variant="contained"
            disabled={!changed}
            loading={update.isPending}
            onClick={() => void save()}
          >
            Save changes
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
