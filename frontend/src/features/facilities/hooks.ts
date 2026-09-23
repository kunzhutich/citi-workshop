import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as facilitiesApi from '../../api/facilities';
import { queryKeys } from '../../api/queryKeys';
import type { BuildingNode, FacilityTree, FloorNode } from '../../api/types';

/**
 * Reading and maintaining buildings, floors and seats.
 *
 * Like the category tree, the facility tree is reference data read by the
 * report questionnaire on every visit, so it is cached for an hour. Every
 * mutation below invalidates the whole `facilities` prefix rather than
 * patching the cached tree by hand: a bulk seat insert can change one floor's
 * seats and nothing else, but reconstructing that nesting in the client is how
 * the cache and the database start disagreeing.
 */

/** How long the tree is treated as fresh, in milliseconds. */
const TREE_STALE_TIME = 60 * 60_000;

/** The whole hierarchy: buildings, their floors, and each floor's seats. */
export function useFacilityTree(includeInactive = false) {
  return useQuery({
    queryKey: queryKeys.facilities.tree(includeInactive),
    queryFn: () => facilitiesApi.fetchFacilityTree(includeInactive),
    staleTime: TREE_STALE_TIME,
  });
}

/** Find one building in a loaded tree. */
export function findBuilding(
  tree: FacilityTree | undefined,
  buildingId: string | null,
): BuildingNode | undefined {
  if (!buildingId) {
    return undefined;
  }
  return tree?.buildings.find((building) => building.id === buildingId);
}

/** Find one floor in a loaded tree, wherever it sits. */
export function findFloor(
  tree: FacilityTree | undefined,
  floorId: string | null,
): FloorNode | undefined {
  if (!floorId) {
    return undefined;
  }
  for (const building of tree?.buildings ?? []) {
    const floor = building.floors.find((candidate) => candidate.id === floorId);
    if (floor) {
      return floor;
    }
  }
  return undefined;
}

/** Re-read the facility tree after any change to it. */
function useFacilityMutation<TVariables, TData>(
  mutationFn: (variables: TVariables) => Promise<TData>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.facilities.all }),
  });
}

export function useCreateBuilding() {
  return useFacilityMutation(facilitiesApi.createBuilding);
}

export function useUpdateBuilding() {
  return useFacilityMutation(
    ({ id, payload }: { id: string; payload: Parameters<typeof facilitiesApi.updateBuilding>[1] }) =>
      facilitiesApi.updateBuilding(id, payload),
  );
}

export function useDeleteBuilding() {
  return useFacilityMutation(facilitiesApi.deleteBuilding);
}

export function useCreateFloor() {
  return useFacilityMutation(
    ({ buildingId, payload }: { buildingId: string; payload: facilitiesApi.FloorPayload }) =>
      facilitiesApi.createFloor(buildingId, payload),
  );
}

export function useUpdateFloor() {
  return useFacilityMutation(
    ({ id, payload }: { id: string; payload: Parameters<typeof facilitiesApi.updateFloor>[1] }) =>
      facilitiesApi.updateFloor(id, payload),
  );
}

export function useDeleteFloor() {
  return useFacilityMutation(facilitiesApi.deleteFloor);
}

export function useCreateSeat() {
  return useFacilityMutation(
    ({ floorId, payload }: { floorId: string; payload: facilitiesApi.SeatPayload }) =>
      facilitiesApi.createSeat(floorId, payload),
  );
}

export function useBulkCreateSeats() {
  return useFacilityMutation(
    ({
      floorId,
      payload,
    }: {
      floorId: string;
      payload: Parameters<typeof facilitiesApi.bulkCreateSeats>[1];
    }) => facilitiesApi.bulkCreateSeats(floorId, payload),
  );
}

export function useUpdateSeat() {
  return useFacilityMutation(
    ({ id, payload }: { id: string; payload: Parameters<typeof facilitiesApi.updateSeat>[1] }) =>
      facilitiesApi.updateSeat(id, payload),
  );
}

export function useDeleteSeat() {
  return useFacilityMutation(facilitiesApi.deleteSeat);
}
