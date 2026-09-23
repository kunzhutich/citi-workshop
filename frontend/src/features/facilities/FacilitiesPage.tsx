import AddIcon from '@mui/icons-material/Add';
import ApartmentIcon from '@mui/icons-material/Apartment';
import LayersIcon from '@mui/icons-material/Layers';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import FormControlLabel from '@mui/material/FormControlLabel';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import { describeError } from '../../api/errors';
import type { Building, BuildingNode, Floor, FloorNode, Seat } from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState, QueryState } from '../../components/QueryState';
import { useSnackbar } from '../../components/SnackbarContext';
import { seatTypeLabel } from '../../display/labels';
import { BuildingDialog, BulkSeatsDialog, FloorDialog, SeatDialog } from './FacilityDialogs';
import {
  useBulkCreateSeats,
  useCreateBuilding,
  useCreateFloor,
  useCreateSeat,
  useDeleteBuilding,
  useDeleteFloor,
  useDeleteSeat,
  useFacilityTree,
  useUpdateBuilding,
  useUpdateFloor,
  useUpdateSeat,
} from './hooks';

/** Which dialog is open, and what it is acting on. */
type Dialog =
  | { kind: 'none' }
  | { kind: 'building'; building: Building | null }
  | { kind: 'floor'; buildingId: string; floor: Floor | null }
  | { kind: 'seat'; floorId: string; seat: Seat | null }
  | { kind: 'bulk-seats'; floorId: string; floorName: string };

/**
 * Buildings, their floors, and the desks and rooms on each floor.
 *
 * Two panes, because the data is a tree whose leaves are a table: a floor has
 * forty desks, and forty desks nested inside an expander is a scroll rather
 * than a list. The tree answers "where am I", the table answers "what is here".
 *
 * The whole hierarchy arrives in one `GET /facilities/tree`, so expanding a
 * building and selecting a floor are both instant — the seats are already
 * loaded. A facility is tens of rows; paginating it would buy nothing and cost
 * a request per click.
 *
 * Every delete is worded "Remove", because the API may delete or deactivate:
 * a floor an incident was reported on keeps existing so that ticket still has
 * a location. The result message says which happened.
 */
export function FacilitiesPage() {
  const { notify } = useSnackbar();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [expandedBuildingId, setExpandedBuildingId] = useState<string | null>(null);
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });

  const tree = useFacilityTree(includeInactive);
  const createBuilding = useCreateBuilding();
  const updateBuilding = useUpdateBuilding();
  const deleteBuilding = useDeleteBuilding();
  const createFloor = useCreateFloor();
  const updateFloor = useUpdateFloor();
  const deleteFloor = useDeleteFloor();
  const createSeat = useCreateSeat();
  const updateSeat = useUpdateSeat();
  const deleteSeat = useDeleteSeat();
  const bulkCreateSeats = useBulkCreateSeats();

  const buildings = tree.data?.buildings ?? [];
  const selectedFloor = buildings
    .flatMap((building) => building.floors)
    .find((floor) => floor.id === selectedFloorId);

  const close = () => setDialog({ kind: 'none' });

  /** Run a removal and report which of delete or deactivate happened. */
  const remove = async (action: () => Promise<{ detail: string; deactivated: boolean }>) => {
    try {
      const result = await action();
      notify(result.detail, result.deactivated ? 'warning' : 'success');
    } catch (error) {
      notify(describeError(error, 'Could not remove that.').message, 'error');
    }
  };

  return (
    <Box>
      <PageHeader
        title="Facilities"
        description="Where people work, and therefore where problems can be reported."
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setDialog({ kind: 'building', building: null })}
          >
            New building
          </Button>
        }
      />

      <FormControlLabel
        control={
          <Switch
            checked={includeInactive}
            onChange={(event) => setIncludeInactive(event.target.checked)}
          />
        }
        label="Show deactivated"
        sx={{ mb: 2 }}
      />

      <QueryState
        isPending={tree.isPending}
        error={tree.error}
        errorFallback="Could not load the facility tree."
      >
        {buildings.length === 0 ? (
          <EmptyState
            title="No buildings yet"
            description="Nothing can be reported until there is somewhere to report it from."
            action={
              <Button
                variant="contained"
                onClick={() => setDialog({ kind: 'building', building: null })}
              >
                New building
              </Button>
            }
          />
        ) : (
          <Box
            sx={{
              display: 'grid',
              gap: 3,
              gridTemplateColumns: { xs: '1fr', md: 'minmax(260px, 1fr) minmax(0, 2fr)' },
              alignItems: 'start',
            }}
          >
            <Paper variant="outlined" sx={{ p: 1 }}>
              <List disablePadding>
                {buildings.map((building) => (
                  <BuildingBranch
                    key={building.id}
                    building={building}
                    expanded={building.id === expandedBuildingId}
                    selectedFloorId={selectedFloorId}
                    onToggle={() =>
                      setExpandedBuildingId(building.id === expandedBuildingId ? null : building.id)
                    }
                    onSelectFloor={setSelectedFloorId}
                    onEdit={() => setDialog({ kind: 'building', building })}
                    onAddFloor={() =>
                      setDialog({ kind: 'floor', buildingId: building.id, floor: null })
                    }
                    onRemove={() => void remove(() => deleteBuilding.mutateAsync(building.id))}
                  />
                ))}
              </List>
            </Paper>

            <Box>
              {selectedFloor ? (
                <SeatPane
                  floor={selectedFloor}
                  onAddSeat={() =>
                    setDialog({ kind: 'seat', floorId: selectedFloor.id, seat: null })
                  }
                  onBulkAdd={() =>
                    setDialog({
                      kind: 'bulk-seats',
                      floorId: selectedFloor.id,
                      floorName: selectedFloor.name,
                    })
                  }
                  onEditFloor={() =>
                    setDialog({
                      kind: 'floor',
                      buildingId: selectedFloor.building_id,
                      floor: selectedFloor,
                    })
                  }
                  onRemoveFloor={() => void remove(() => deleteFloor.mutateAsync(selectedFloor.id))}
                  onEditSeat={(seat) =>
                    setDialog({ kind: 'seat', floorId: selectedFloor.id, seat })
                  }
                  onRemoveSeat={(seat) => void remove(() => deleteSeat.mutateAsync(seat.id))}
                  onReactivateSeat={(seat) =>
                    void updateSeat.mutateAsync({ id: seat.id, payload: { is_active: true } })
                  }
                />
              ) : (
                <EmptyState
                  title="Pick a floor"
                  description="Choose a building, then a floor, to see its desks and rooms."
                />
              )}
            </Box>
          </Box>
        )}
      </QueryState>

      {dialog.kind === 'building' ? (
        <BuildingDialog
          open
          onClose={close}
          building={dialog.building}
          isSubmitting={createBuilding.isPending || updateBuilding.isPending}
          onSubmit={async (payload) => {
            if (dialog.building) {
              await updateBuilding.mutateAsync({ id: dialog.building.id, payload });
              notify('Building updated.');
            } else {
              await createBuilding.mutateAsync(payload);
              notify('Building added.');
            }
          }}
        />
      ) : null}

      {dialog.kind === 'floor' ? (
        <FloorDialog
          open
          onClose={close}
          floor={dialog.floor}
          isSubmitting={createFloor.isPending || updateFloor.isPending}
          onSubmit={async (payload) => {
            if (dialog.floor) {
              await updateFloor.mutateAsync({ id: dialog.floor.id, payload });
              notify('Floor updated.');
            } else {
              await createFloor.mutateAsync({ buildingId: dialog.buildingId, payload });
              notify('Floor added.');
            }
          }}
        />
      ) : null}

      {dialog.kind === 'seat' ? (
        <SeatDialog
          open
          onClose={close}
          seat={dialog.seat}
          isSubmitting={createSeat.isPending || updateSeat.isPending}
          onSubmit={async (payload) => {
            if (dialog.seat) {
              await updateSeat.mutateAsync({ id: dialog.seat.id, payload });
              notify('Updated.');
            } else {
              await createSeat.mutateAsync({ floorId: dialog.floorId, payload });
              notify('Added.');
            }
          }}
        />
      ) : null}

      {dialog.kind === 'bulk-seats' ? (
        <BulkSeatsDialog
          open
          onClose={close}
          floorName={dialog.floorName}
          isSubmitting={bulkCreateSeats.isPending}
          onSubmit={(payload) => bulkCreateSeats.mutateAsync({ floorId: dialog.floorId, payload })}
        />
      ) : null}
    </Box>
  );
}

interface BuildingBranchProps {
  building: BuildingNode;
  expanded: boolean;
  selectedFloorId: string | null;
  onToggle: () => void;
  onSelectFloor: (floorId: string) => void;
  onEdit: () => void;
  onAddFloor: () => void;
  onRemove: () => void;
}

/** One building in the left pane, with its floors underneath. */
function BuildingBranch({
  building,
  expanded,
  selectedFloorId,
  onToggle,
  onSelectFloor,
  onEdit,
  onAddFloor,
  onRemove,
}: BuildingBranchProps) {
  return (
    /*
      One building is one `<li>`, holding its own button and its own nested
      list. Both used to be direct children of the outer `<ul>` — a `<button>`
      and a `<div>` — which is invalid, and which a screen reader may answer by
      not announcing the list or its item count at all. The nesting now matches
      the meaning: a building, and inside it its floors.
    */
    <ListItem disablePadding sx={{ display: 'block' }}>
      <ListItemButton onClick={onToggle} sx={{ borderRadius: 1 }}>
        <ListItemIcon sx={{ minWidth: 36 }}>
          <ApartmentIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText
          primary={`${building.code} — ${building.name}`}
          secondary={`${building.floors.length} ${building.floors.length === 1 ? 'floor' : 'floors'}`}
        />
        {!building.is_active ? <Chip size="small" label="Off" /> : null}
      </ListItemButton>

      <Collapse in={expanded} unmountOnExit>
        <List disablePadding sx={{ pl: 3 }}>
          {building.floors.map((floor) => (
            <ListItem key={floor.id} disablePadding sx={{ display: 'block' }}>
              <ListItemButton
                selected={floor.id === selectedFloorId}
                onClick={() => onSelectFloor(floor.id)}
                sx={{ borderRadius: 1 }}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <LayersIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={floor.name}
                  secondary={`${floor.seats.length} ${floor.seats.length === 1 ? 'place' : 'places'}`}
                />
                {!floor.is_active ? <Chip size="small" label="Off" /> : null}
              </ListItemButton>
            </ListItem>
          ))}

          {/* Named in full. These sit under the floor list, so "Edit" alone
              reads as editing the floor above it rather than the building
              they belong to. */}
          <ListItem disablePadding sx={{ display: 'block' }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, px: 1, py: 1 }}>
              <Button size="small" startIcon={<AddIcon />} onClick={onAddFloor}>
                Add floor
              </Button>
              <Button size="small" onClick={onEdit}>
                Edit building
              </Button>
              <Button size="small" color="warning" onClick={onRemove}>
                Remove building
              </Button>
            </Box>
          </ListItem>
        </List>
      </Collapse>
    </ListItem>
  );
}

interface SeatPaneProps {
  floor: FloorNode;
  onAddSeat: () => void;
  onBulkAdd: () => void;
  onEditFloor: () => void;
  onRemoveFloor: () => void;
  onEditSeat: (seat: Seat) => void;
  onRemoveSeat: (seat: Seat) => void;
  onReactivateSeat: (seat: Seat) => void;
}

/** The right pane: everything on the selected floor. */
function SeatPane({
  floor,
  onAddSeat,
  onBulkAdd,
  onEditFloor,
  onRemoveFloor,
  onEditSeat,
  onRemoveSeat,
  onReactivateSeat,
}: SeatPaneProps) {
  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          mb: 2,
        }}
      >
        <Typography variant="h2" component="h2">
          {floor.name}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          <Button size="small" startIcon={<AddIcon />} onClick={onAddSeat}>
            Add one
          </Button>
          <Button size="small" startIcon={<PlaylistAddIcon />} onClick={onBulkAdd}>
            Add many
          </Button>
          <Button size="small" onClick={onEditFloor}>
            Edit floor
          </Button>
          <Button size="small" color="warning" onClick={onRemoveFloor}>
            Remove floor
          </Button>
        </Box>
      </Box>

      {floor.seats.length === 0 ? (
        <EmptyState
          title="Nothing on this floor yet"
          description="Paste a list of desk codes to fill it in one go."
          action={
            <Button variant="contained" onClick={onBulkAdd}>
              Add many
            </Button>
          }
        />
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" aria-label={`Places on ${floor.name}`}>
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {floor.seats.map((seat) => (
                <TableRow key={seat.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {seat.code}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" label={seatTypeLabel(seat.seat_type)} />
                    {!seat.is_active ? (
                      <Chip size="small" label="Deactivated" sx={{ ml: 1 }} />
                    ) : null}
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => onEditSeat(seat)}>
                      Edit
                    </Button>
                    {seat.is_active ? (
                      <Button size="small" color="warning" onClick={() => onRemoveSeat(seat)}>
                        Remove
                      </Button>
                    ) : (
                      <Button size="small" onClick={() => onReactivateSeat(seat)}>
                        Reactivate
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
