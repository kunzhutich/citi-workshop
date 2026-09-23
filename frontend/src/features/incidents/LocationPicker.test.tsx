import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { FacilityTree } from '../../api/types';
import { renderWithAuth } from '../../test/renderWithProviders';
import { LocationPicker, type LocationValue } from './LocationPicker';

/**
 * Which location fields a reporter is asked for, and why.
 *
 * The answer is the group's `location_detail`, which an admin sets on the
 * Categories screen. This component decides what to *ask*; the API decides
 * what is valid, and re-checks all of it.
 */

const TREE: FacilityTree = {
  buildings: [
    {
      id: 'b1',
      name: 'San Francisco HQ',
      code: 'SFO-1',
      address: null,
      is_active: true,
      floors: [
        {
          id: 'f1',
          building_id: 'b1',
          name: 'Level 3',
          level_number: 3,
          is_active: true,
          seats: [
            { id: 's1', floor_id: 'f1', code: '3-A-01', seat_type: 'DESK', is_active: true },
            {
              id: 's2',
              floor_id: 'f1',
              code: 'Kestrel',
              seat_type: 'MEETING_ROOM',
              is_active: true,
            },
          ],
        },
        // A second floor, so the cascade tests can change a selection. A
        // select does not fire `onChange` when the option chosen is the one
        // already chosen, which is how the first version of those two tests
        // passed nothing and asserted nothing.
        {
          id: 'f2',
          building_id: 'b1',
          name: 'Level 4',
          level_number: 4,
          is_active: true,
          seats: [
            { id: 's3', floor_id: 'f2', code: '4-A-01', seat_type: 'DESK', is_active: true },
          ],
        },
      ],
    },
    {
      id: 'b2',
      name: 'London office',
      code: 'LON-1',
      address: null,
      is_active: true,
      floors: [
        {
          id: 'f3',
          building_id: 'b2',
          name: 'Ground',
          level_number: 0,
          is_active: true,
          seats: [],
        },
      ],
    },
  ],
};

const EMPTY: LocationValue = { building_id: null, floor_id: null, seat_id: null };
const AT_A_FLOOR: LocationValue = { building_id: 'b1', floor_id: 'f1', seat_id: null };

describe('what is asked for', () => {
  it('asks a BUILDING group for a building, and hides the rest behind a link', () => {
    renderWithAuth(
      <LocationPicker
        tree={TREE}
        locationDetail="BUILDING"
        groupName="Software"
        value={EMPTY}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/Building/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Floor/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add more detail/ })).toBeInTheDocument();
  });

  it('reveals the rest when the link is followed', async () => {
    renderWithAuth(
      <LocationPicker
        tree={TREE}
        locationDetail="BUILDING"
        groupName="Software"
        value={AT_A_FLOOR}
        onChange={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Add more detail/ }));

    expect(screen.getByLabelText(/Floor/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Desk/)).toBeInTheDocument();
  });

  it('asks a FLOOR group for a floor, with no link to follow', () => {
    renderWithAuth(
      <LocationPicker
        tree={TREE}
        locationDetail="FLOOR"
        groupName="Hardware"
        value={EMPTY}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/Floor/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add more detail/ })).not.toBeInTheDocument();
  });

  it('asks a SEAT group for all three', () => {
    renderWithAuth(
      <LocationPicker
        tree={TREE}
        locationDetail="SEAT"
        groupName="Hardware"
        value={AT_A_FLOOR}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/Building/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Floor/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Desk/)).toBeInTheDocument();
  });
});

describe('meeting rooms', () => {
  it('calls the field a Room and offers only rooms', async () => {
    renderWithAuth(
      <LocationPicker
        tree={TREE}
        locationDetail="SEAT"
        groupName="Meeting Rooms"
        value={AT_A_FLOOR}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/Room/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Desk/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/Room/));

    expect(screen.getByRole('option', { name: 'Kestrel' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /3-A-01/ })).not.toBeInTheDocument();
  });
});

describe('the cascade', () => {
  it('clears the floor and seat when the building changes', async () => {
    const onChange = vi.fn();
    renderWithAuth(
      <LocationPicker
        tree={TREE}
        locationDetail="SEAT"
        groupName="Hardware"
        value={{ building_id: 'b1', floor_id: 'f1', seat_id: 's1' }}
        onChange={onChange}
      />,
    );

    await userEvent.click(screen.getByLabelText(/Building/));
    await userEvent.click(screen.getByRole('option', { name: /LON-1/ }));

    // A floor in another building and a seat on another floor are both 422s
    // from the API; clearing them is what stops the form offering one.
    expect(onChange).toHaveBeenCalledWith({ building_id: 'b2', floor_id: null, seat_id: null });
  });

  it('clears the seat when the floor changes', async () => {
    const onChange = vi.fn();
    renderWithAuth(
      <LocationPicker
        tree={TREE}
        locationDetail="SEAT"
        groupName="Hardware"
        value={{ building_id: 'b1', floor_id: 'f1', seat_id: 's1' }}
        onChange={onChange}
      />,
    );

    await userEvent.click(screen.getByLabelText(/Floor/));
    await userEvent.click(screen.getByRole('option', { name: 'Level 4' }));

    expect(onChange).toHaveBeenCalledWith({ building_id: 'b1', floor_id: 'f2', seat_id: null });
  });

  it('will not let a floor be chosen before a building', () => {
    renderWithAuth(
      <LocationPicker
        tree={TREE}
        locationDetail="FLOOR"
        groupName="Hardware"
        value={EMPTY}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Choose a building first')).toBeInTheDocument();
  });
});

describe('the API has the last word', () => {
  it('shows a 422 on the field the API named', () => {
    renderWithAuth(
      <LocationPicker
        tree={TREE}
        locationDetail="SEAT"
        groupName="Hardware"
        value={AT_A_FLOOR}
        onChange={vi.fn()}
        fieldErrors={{ seat_id: 'A desk is required for this kind of problem.' }}
      />,
    );

    expect(
      screen.getByText('A desk is required for this kind of problem.'),
    ).toBeInTheDocument();
  });
});
