import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { useState } from 'react';

import type { CategoryCreatePayload, CategoryUpdatePayload } from '../../api/categories';
import { describeError } from '../../api/errors';
import type { Category, LocationDetail } from '../../api/types';
import { ResponsiveDialog } from '../../components/ResponsiveDialog';
import { LOCATION_DETAILS, locationDetailLabel } from '../../display/labels';
import { CategoryIcon } from '../incidents/CategoryIcon';
import { CATEGORY_ICON_NAMES } from '../incidents/categoryIcons';

export interface CategoryDialogProps {
  open: boolean;
  onClose: () => void;
  /** The category being edited, or null when creating a new one. */
  category: Category | null;
  /** The group a new subcategory belongs to; null makes it a group. */
  parentId: string | null;
  onSubmit: (payload: CategoryCreatePayload | CategoryUpdatePayload) => Promise<unknown>;
  isSubmitting: boolean;
}

/**
 * Add or edit a category, group or subcategory.
 *
 * One dialog for four cases, because they share every field they have. What
 * differs is which fields *exist*: a group carries the hint, the icon and the
 * location precision that the questionnaire's first step is drawn from, and a
 * subcategory inherits all three from its group. Showing a subcategory an icon
 * field would offer a setting that goes nowhere.
 */
export function CategoryDialog({
  open,
  onClose,
  category,
  parentId,
  onSubmit,
  isSubmitting,
}: CategoryDialogProps) {
  const isGroup = category ? category.parent_id === null : parentId === null;

  const [name, setName] = useState(category?.name ?? '');
  const [hint, setHint] = useState(category?.hint ?? '');
  const [icon, setIcon] = useState(category?.icon ?? '');
  const [locationDetail, setLocationDetail] = useState<LocationDetail>(
    category?.location_detail ?? 'BUILDING',
  );
  const [sortOrder, setSortOrder] = useState(String(category?.sort_order ?? 0));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async () => {
    setFormError(null);
    setFieldErrors({});

    const shared = {
      name: name.trim(),
      sort_order: Number(sortOrder) || 0,
      ...(isGroup
        ? { hint: hint.trim() || null, icon: icon || null, location_detail: locationDetail }
        : {}),
    };

    try {
      await onSubmit(category ? shared : { ...shared, parent_id: parentId });
      onClose();
    } catch (error) {
      const described = describeError(error, 'Could not save this category.');
      setFieldErrors(described.fieldErrors);
      setFormError(described.message);
    }
  };

  const title = category
    ? `Edit ${isGroup ? 'group' : 'subcategory'}`
    : isGroup
      ? 'New group'
      : 'New subcategory';

  return (
    <ResponsiveDialog open={open} onClose={onClose} title={title}>
      <DialogContent>
        {isGroup ? (
          <DialogContentText>
            Groups are the cards on the first step of the report questionnaire.
          </DialogContentText>
        ) : null}

        <Box sx={{ display: 'grid', gap: 2, mt: 2 }}>
          <TextField
            required
            autoFocus
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={Boolean(fieldErrors.name)}
            helperText={fieldErrors.name}
          />

          {isGroup ? (
            <>
              <TextField
                label="Hint"
                value={hint}
                onChange={(event) => setHint(event.target.value)}
                error={Boolean(fieldErrors.hint)}
                helperText={
                  fieldErrors.hint ?? 'The line under the name on the card, in plain language.'
                }
              />
              <TextField
                select
                label="Icon"
                value={icon}
                onChange={(event) => setIcon(event.target.value)}
                error={Boolean(fieldErrors.icon)}
                helperText={fieldErrors.icon}
              >
                <MenuItem value="">No icon</MenuItem>
                {CATEGORY_ICON_NAMES.map((option) => (
                  <MenuItem key={option} value={option}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <CategoryIcon iconName={option} fontSize="small" />
                      {option}
                    </Box>
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Location needed when reporting"
                value={locationDetail}
                onChange={(event) => setLocationDetail(event.target.value as LocationDetail)}
                error={Boolean(fieldErrors.location_detail)}
                helperText={
                  fieldErrors.location_detail ??
                  'Decides which location fields the questionnaire asks for.'
                }
              >
                {LOCATION_DETAILS.map((option) => (
                  <MenuItem key={option} value={option}>
                    {locationDetailLabel(option)}
                  </MenuItem>
                ))}
              </TextField>
            </>
          ) : null}

          <TextField
            label="Display order"
            type="number"
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value)}
            error={Boolean(fieldErrors.sort_order)}
            helperText={fieldErrors.sort_order ?? 'Lower numbers appear first.'}
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
          disabled={name.trim() === ''}
        >
          Save
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
