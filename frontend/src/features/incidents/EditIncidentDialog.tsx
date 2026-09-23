import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { useState } from 'react';

import { describeError } from '../../api/errors';
import type { IncidentUpdatePayload } from '../../api/incidents';
import type { Incident } from '../../api/types';
import { QueryState } from '../../components/QueryState';
import { ResponsiveDialog } from '../../components/ResponsiveDialog';
import { useCategoryTree } from '../categories/hooks';
import { useFacilityTree } from '../facilities/hooks';
import { LocationPicker, type LocationValue } from './LocationPicker';
import { reportTextSchema, TITLE_MAX_LENGTH } from './reportSchema';

export interface EditIncidentDialogProps {
  open: boolean;
  onClose: () => void;
  incident: Incident;
  onSubmit: (payload: IncidentUpdatePayload) => Promise<unknown>;
  isSubmitting: boolean;
}

/**
 * Correct what a ticket says about itself.
 *
 * The same four answers the questionnaire collected — subcategory, location,
 * title, description — reachable while the API still permits the edit. It does
 * not offer priority: that has its own permission (`can_change_priority`, a
 * wider one than `can_edit`) and therefore its own dialog.
 *
 * The subcategory picker is a dropdown here rather than the questionnaire's
 * cards. Reporting is a guided first encounter; editing is a correction by
 * someone who already knows what they meant, and a dialog listing 37 cards
 * would make the common case — a typo in the title — harder to reach.
 */
export function EditIncidentDialog({
  open,
  onClose,
  incident,
  onSubmit,
  isSubmitting,
}: EditIncidentDialogProps) {
  const categories = useCategoryTree();
  const facilities = useFacilityTree();

  const [categoryId, setCategoryId] = useState(incident.category.id);
  const [location, setLocation] = useState<LocationValue>({
    building_id: incident.location.building_id,
    floor_id: incident.location.floor_id,
    seat_id: incident.location.seat_id,
  });
  const [title, setTitle] = useState(incident.title);
  const [description, setDescription] = useState(incident.description);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const group = categories.data?.groups.find((candidate) =>
    candidate.children.some((child) => child.id === categoryId),
  );

  const submit = async () => {
    setFormError(null);

    const parsed = reportTextSchema.safeParse({ title, description });
    if (!parsed.success || !location.building_id) {
      setFieldErrors(
        Object.fromEntries(
          (parsed.error?.issues ?? []).map((issue) => [String(issue.path[0]), issue.message]),
        ),
      );
      return;
    }
    setFieldErrors({});

    try {
      await onSubmit({
        title: parsed.data.title,
        description: parsed.data.description,
        category_id: categoryId,
        building_id: location.building_id,
        floor_id: location.floor_id,
        seat_id: location.seat_id,
      });
      onClose();
    } catch (error) {
      const described = describeError(error, 'Could not save these changes.');
      setFieldErrors(described.fieldErrors);
      setFormError(described.message);
    }
  };

  return (
    <ResponsiveDialog open={open} onClose={onClose} title="Edit this ticket" maxWidth="sm">
      <DialogContent dividers>
        <QueryState
          isPending={categories.isPending || facilities.isPending}
          error={categories.error ?? facilities.error}
          errorFallback="Could not load the categories and locations."
        >
          {categories.data && facilities.data ? (
            <Box sx={{ display: 'grid', gap: 2 }}>
              <TextField
                label="Title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                error={Boolean(fieldErrors.title)}
                helperText={fieldErrors.title}
                slotProps={{ htmlInput: { maxLength: TITLE_MAX_LENGTH } }}
                required
              />
              <TextField
                label="What happened?"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                error={Boolean(fieldErrors.description)}
                helperText={fieldErrors.description}
                multiline
                minRows={4}
                required
              />
              <TextField
                select
                label="Category"
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                error={Boolean(fieldErrors.category_id)}
                helperText={fieldErrors.category_id}
                required
              >
                {categories.data.groups.flatMap((groupOption) =>
                  groupOption.children.map((child) => (
                    <MenuItem key={child.id} value={child.id}>
                      {groupOption.name} › {child.name}
                    </MenuItem>
                  )),
                )}
              </TextField>

              <LocationPicker
                tree={facilities.data}
                locationDetail={group?.location_detail ?? 'BUILDING'}
                groupName={group?.name}
                value={location}
                onChange={setLocation}
                fieldErrors={fieldErrors}
              />

              {formError ? <Alert severity="error">{formError}</Alert> : null}
            </Box>
          ) : null}
        </QueryState>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => void submit()} loading={isSubmitting}>
          Save changes
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
