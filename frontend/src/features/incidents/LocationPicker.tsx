import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { useState } from 'react';

import type { FacilityTree, LocationDetail } from '../../api/types';
import { seatFieldLabel, seatTypeLabel } from '../../display/labels';
import { findBuilding, findFloor } from '../facilities/hooks';

/**
 * Where a problem is, asked at the precision its category needs.
 *
 * The three fields are one component rather than three, because they are not
 * independent: a floor only makes sense inside a building, a seat only inside
 * a floor, and changing a building has to clear both. Splitting them would put
 * that cascade in whichever parent happened to use them.
 *
 * What a group requires comes from its `location_detail`, which is set on the
 * Categories screen and enforced again by `services/incident_service.py`. This
 * component decides what to *ask*; it never decides what is valid.
 */

export interface LocationValue {
  building_id: string | null;
  floor_id: string | null;
  seat_id: string | null;
}

export interface LocationPickerProps {
  tree: FacilityTree;
  /** How precise a location the chosen category group needs. */
  locationDetail: LocationDetail;
  /** The group's name, which decides whether a seat is a "Desk" or a "Room". */
  groupName: string | null | undefined;
  value: LocationValue;
  onChange: (value: LocationValue) => void;
  /** Field name → message, from a 422 the API returned. */
  fieldErrors?: Record<string, string>;
}

export function LocationPicker({
  tree,
  locationDetail,
  groupName,
  value,
  onChange,
  fieldErrors = {},
}: LocationPickerProps) {
  // Only meaningful when `locationDetail` is BUILDING, where floor and seat
  // are hidden until asked for. Kept open once opened, so a reporter who adds
  // detail and then changes building does not have to find the link again.
  const [showOptionalDetail, setShowOptionalDetail] = useState(false);

  const building = findBuilding(tree, value.building_id);
  const floor = findFloor(tree, value.floor_id);

  const isMeetingRoom = seatFieldLabel(groupName) === 'Room';
  const seats = (floor?.seats ?? []).filter((seat) =>
    isMeetingRoom ? seat.seat_type === 'MEETING_ROOM' : true,
  );

  const wantsFloor = locationDetail !== 'BUILDING' || showOptionalDetail;
  const wantsSeat = locationDetail === 'SEAT' || showOptionalDetail;

  /** Changing a building invalidates the floor and seat chosen under it. */
  const selectBuilding = (buildingId: string) => {
    onChange({ building_id: buildingId || null, floor_id: null, seat_id: null });
  };

  /** Changing a floor invalidates the seat chosen on it. */
  const selectFloor = (floorId: string) => {
    onChange({ ...value, floor_id: floorId || null, seat_id: null });
  };

  const selectSeat = (seatId: string) => {
    onChange({ ...value, seat_id: seatId || null });
  };

  return (
    <Box sx={{ display: 'grid', gap: 2, maxWidth: 520 }}>
      <TextField
        select
        required
        label="Building"
        value={value.building_id ?? ''}
        onChange={(event) => selectBuilding(event.target.value)}
        error={Boolean(fieldErrors.building_id)}
        helperText={fieldErrors.building_id}
        slotProps={{ htmlInput: { 'data-testid': 'building-select' } }}
      >
        {tree.buildings.map((option) => (
          <MenuItem key={option.id} value={option.id}>
            {option.code} — {option.name}
          </MenuItem>
        ))}
      </TextField>

      {wantsFloor ? (
        <TextField
          select
          required={locationDetail !== 'BUILDING'}
          label="Floor"
          value={value.floor_id ?? ''}
          onChange={(event) => selectFloor(event.target.value)}
          disabled={!building}
          error={Boolean(fieldErrors.floor_id)}
          helperText={fieldErrors.floor_id ?? (building ? undefined : 'Choose a building first')}
          slotProps={{ htmlInput: { 'data-testid': 'floor-select' } }}
        >
          {(building?.floors ?? []).map((option) => (
            <MenuItem key={option.id} value={option.id}>
              {option.name}
            </MenuItem>
          ))}
        </TextField>
      ) : null}

      {wantsSeat ? (
        <TextField
          select
          required={locationDetail === 'SEAT'}
          label={seatFieldLabel(groupName)}
          value={value.seat_id ?? ''}
          onChange={(event) => selectSeat(event.target.value)}
          disabled={!floor}
          error={Boolean(fieldErrors.seat_id)}
          helperText={
            fieldErrors.seat_id ??
            (floor
              ? undefined
              : `Choose a floor first`)
          }
          slotProps={{ htmlInput: { 'data-testid': 'seat-select' } }}
        >
          {seats.map((option) => (
            <MenuItem key={option.id} value={option.id}>
              {option.code}
              {isMeetingRoom ? '' : ` · ${seatTypeLabel(option.seat_type)}`}
            </MenuItem>
          ))}
        </TextField>
      ) : null}

      {/*
        Only BUILDING groups get the link. A FLOOR group already shows the
        floor, and its seat field is genuinely optional but rarely useful; a
        SEAT group shows everything because everything is required.
      */}
      {locationDetail === 'BUILDING' && !showOptionalDetail ? (
        <Link
          component="button"
          type="button"
          onClick={() => setShowOptionalDetail(true)}
          sx={{ justifySelf: 'start' }}
        >
          Add more detail (floor and desk)
        </Link>
      ) : null}
    </Box>
  );
}
