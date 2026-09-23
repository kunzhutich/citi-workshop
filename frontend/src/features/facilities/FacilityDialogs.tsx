import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { useState } from 'react';

import { describeError } from '../../api/errors';
import type { Building, Floor, Seat, SeatType } from '../../api/types';
import { ResponsiveDialog } from '../../components/ResponsiveDialog';
import { SEAT_TYPES, seatTypeLabel } from '../../display/labels';

/**
 * The four dialogs the Facilities screen opens.
 *
 * They share a module rather than a file each because they share everything
 * that matters: three or four fields, one submit, the same mapping of the
 * API's field errors onto inputs. Four files would be four copies of the same
 * twelve lines of error handling, and the day one of them is fixed the other
 * three are not.
 *
 * They are separate *components* all the same — a single "facility dialog"
 * switching on a `kind` prop would have five optional fields and a comment
 * explaining which apply when.
 */

/** Shared error state, so each dialog below is only its own fields. */
function useSubmitState() {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>, fallback: string, onDone: () => void) => {
    setFormError(null);
    setFieldErrors({});
    try {
      await action();
      onDone();
    } catch (error) {
      const described = describeError(error, fallback);
      setFieldErrors(described.fieldErrors);
      setFormError(described.message);
    }
  };

  return { fieldErrors, formError, run };
}

export interface BuildingDialogProps {
  open: boolean;
  onClose: () => void;
  building: Building | null;
  onSubmit: (payload: { name: string; code: string; address: string | null }) => Promise<unknown>;
  isSubmitting: boolean;
}

/** Add or rename a building. */
export function BuildingDialog({
  open,
  onClose,
  building,
  onSubmit,
  isSubmitting,
}: BuildingDialogProps) {
  const [name, setName] = useState(building?.name ?? '');
  const [code, setCode] = useState(building?.code ?? '');
  const [address, setAddress] = useState(building?.address ?? '');
  const { fieldErrors, formError, run } = useSubmitState();

  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      title={building ? `Edit ${building.code}` : 'New building'}
    >
      <DialogContent>
        <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
          <TextField
            required
            autoFocus
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="San Francisco HQ"
            error={Boolean(fieldErrors.name)}
            helperText={fieldErrors.name}
          />
          <TextField
            required
            label="Code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="SFO-1"
            error={Boolean(fieldErrors.code)}
            helperText={fieldErrors.code ?? 'The short form shown in dense tables.'}
          />
          <TextField
            label="Address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            error={Boolean(fieldErrors.address)}
            helperText={fieldErrors.address}
          />
          {formError ? <Alert severity="error">{formError}</Alert> : null}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          loading={isSubmitting}
          disabled={name.trim() === '' || code.trim() === ''}
          onClick={() =>
            void run(
              () =>
                onSubmit({ name: name.trim(), code: code.trim(), address: address.trim() || null }),
              'Could not save this building.',
              onClose,
            )
          }
        >
          Save
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}

export interface FloorDialogProps {
  open: boolean;
  onClose: () => void;
  floor: Floor | null;
  onSubmit: (payload: { name: string; level_number: number }) => Promise<unknown>;
  isSubmitting: boolean;
}

/** Add or rename a floor. */
export function FloorDialog({ open, onClose, floor, onSubmit, isSubmitting }: FloorDialogProps) {
  const [name, setName] = useState(floor?.name ?? '');
  const [levelNumber, setLevelNumber] = useState(String(floor?.level_number ?? 1));
  const { fieldErrors, formError, run } = useSubmitState();

  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      title={floor ? `Edit ${floor.name}` : 'New floor'}
      maxWidth="xs"
    >
      <DialogContent>
        <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
          <TextField
            required
            autoFocus
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Level 3"
            error={Boolean(fieldErrors.name)}
            helperText={fieldErrors.name}
          />
          <TextField
            required
            label="Storey number"
            type="number"
            value={levelNumber}
            onChange={(event) => setLevelNumber(event.target.value)}
            error={Boolean(fieldErrors.level_number)}
            helperText={
              fieldErrors.level_number ?? 'Unique within the building. Negative for basements.'
            }
          />
          {formError ? <Alert severity="error">{formError}</Alert> : null}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          loading={isSubmitting}
          disabled={name.trim() === ''}
          onClick={() =>
            void run(
              () => onSubmit({ name: name.trim(), level_number: Number(levelNumber) || 0 }),
              'Could not save this floor.',
              onClose,
            )
          }
        >
          Save
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}

export interface SeatDialogProps {
  open: boolean;
  onClose: () => void;
  seat: Seat | null;
  onSubmit: (payload: { code: string; seat_type: SeatType }) => Promise<unknown>;
  isSubmitting: boolean;
}

/** Add or edit one desk or room. */
export function SeatDialog({ open, onClose, seat, onSubmit, isSubmitting }: SeatDialogProps) {
  const [code, setCode] = useState(seat?.code ?? '');
  const [seatType, setSeatType] = useState<SeatType>(seat?.seat_type ?? 'DESK');
  const { fieldErrors, formError, run } = useSubmitState();

  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      title={seat ? `Edit ${seat.code}` : 'New desk or room'}
      maxWidth="xs"
    >
      <DialogContent>
        <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
          <TextField
            required
            autoFocus
            label="Code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="3-A-12"
            error={Boolean(fieldErrors.code)}
            helperText={fieldErrors.code ?? 'Unique on this floor.'}
          />
          <TextField
            select
            label="Type"
            value={seatType}
            onChange={(event) => setSeatType(event.target.value as SeatType)}
          >
            {SEAT_TYPES.map((option) => (
              <MenuItem key={option} value={option}>
                {seatTypeLabel(option)}
              </MenuItem>
            ))}
          </TextField>
          {formError ? <Alert severity="error">{formError}</Alert> : null}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          loading={isSubmitting}
          disabled={code.trim() === ''}
          onClick={() =>
            void run(
              () => onSubmit({ code: code.trim(), seat_type: seatType }),
              'Could not save this seat.',
              onClose,
            )
          }
        >
          Save
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}

export interface BulkSeatsDialogProps {
  open: boolean;
  onClose: () => void;
  floorName: string;
  onSubmit: (payload: { codes: string[]; seat_type: SeatType }) => Promise<{
    created_count: number;
    skipped_count: number;
  }>;
  isSubmitting: boolean;
}

/**
 * Add a floor's worth of desks from a pasted list.
 *
 * One code per line, because that is the shape the list is already in when it
 * comes out of a spreadsheet or a floor plan. Blank lines and repeats are
 * expected input rather than mistakes — the API drops both — and codes the
 * floor already has come back as skipped rather than failing the whole paste,
 * so running it twice is safe.
 */
export function BulkSeatsDialog({
  open,
  onClose,
  floorName,
  onSubmit,
  isSubmitting,
}: BulkSeatsDialogProps) {
  const [text, setText] = useState('');
  const [seatType, setSeatType] = useState<SeatType>('DESK');
  const [result, setResult] = useState<{ created_count: number; skipped_count: number } | null>(
    null,
  );
  const { formError, run } = useSubmitState();

  const codes = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <ResponsiveDialog open={open} onClose={onClose} title={`Add many to ${floorName}`}>
      <DialogContent>
        <DialogContentText>One code per line. Repeats and blank lines are ignored.</DialogContentText>
        <Box sx={{ display: 'grid', gap: 2, mt: 2 }}>
          <TextField
            autoFocus
            label="Codes"
            value={text}
            onChange={(event) => setText(event.target.value)}
            multiline
            minRows={8}
            placeholder={'3-A-01\n3-A-02\n3-A-03'}
            helperText={`${codes.length} ${codes.length === 1 ? 'code' : 'codes'}`}
          />
          <TextField
            select
            label="Type"
            value={seatType}
            onChange={(event) => setSeatType(event.target.value as SeatType)}
            helperText="Applied to every code in the list."
          >
            {SEAT_TYPES.map((option) => (
              <MenuItem key={option} value={option}>
                {seatTypeLabel(option)}
              </MenuItem>
            ))}
          </TextField>

          {result ? (
            <Alert severity={result.skipped_count > 0 ? 'warning' : 'success'}>
              Added {result.created_count}.
              {result.skipped_count > 0
                ? ` ${result.skipped_count} already existed and were left alone.`
                : ''}
            </Alert>
          ) : null}
          {formError ? <Alert severity="error">{formError}</Alert> : null}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{result ? 'Done' : 'Cancel'}</Button>
        <Button
          variant="contained"
          loading={isSubmitting}
          disabled={codes.length === 0}
          onClick={() =>
            void run(
              async () => {
                const outcome = await onSubmit({ codes, seat_type: seatType });
                setResult(outcome);
                setText('');
              },
              'Could not add these seats.',
              // Deliberately stays open: the result is the point, and a dialog
              // that vanishes has not told anyone what it skipped.
              () => {},
            )
          }
        >
          Add {codes.length > 0 ? codes.length : ''}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
