import { apiClient } from './client';
import type {
  Building,
  DeleteResult,
  FacilityTree,
  Floor,
  Page,
  Seat,
  SeatBulkResult,
  SeatType,
} from './types';

/**
 * Buildings, floors and seats.
 *
 * Three tables but one domain — a location is only meaningful as a path
 * through all three — so they share a module here exactly as they share a
 * router on the API.
 */

export interface BuildingPayload {
  name: string;
  code: string;
  address?: string | null;
}

export interface FloorPayload {
  name: string;
  level_number: number;
}

export interface SeatPayload {
  code: string;
  seat_type: SeatType;
}

/**
 * The whole hierarchy in one response.
 *
 * Returned whole rather than paginated: the location picker needs every level
 * at once to decide what a group requires, and a facility is tens of rows.
 */
export async function fetchFacilityTree(includeInactive = false): Promise<FacilityTree> {
  const { data } = await apiClient.get<FacilityTree>('/facilities/tree', {
    params: includeInactive ? { include_inactive: true } : undefined,
  });
  return data;
}

/** Create a building. Admin only. */
export async function createBuilding(payload: BuildingPayload): Promise<Building> {
  const { data } = await apiClient.post<Building>('/buildings', payload);
  return data;
}

/** Apply a partial update to a building. Admin only. */
export async function updateBuilding(
  id: string,
  payload: Partial<BuildingPayload> & { is_active?: boolean },
): Promise<Building> {
  const { data } = await apiClient.patch<Building>(`/buildings/${id}`, payload);
  return data;
}

/** Delete a building, or deactivate it when it is referenced. */
export async function deleteBuilding(id: string): Promise<DeleteResult> {
  const { data } = await apiClient.delete<DeleteResult>(`/buildings/${id}`);
  return data;
}

/** Add a floor to a building. Admin only. */
export async function createFloor(buildingId: string, payload: FloorPayload): Promise<Floor> {
  const { data } = await apiClient.post<Floor>(`/buildings/${buildingId}/floors`, payload);
  return data;
}

/** Apply a partial update to a floor. A floor cannot change building. */
export async function updateFloor(
  id: string,
  payload: Partial<FloorPayload> & { is_active?: boolean },
): Promise<Floor> {
  const { data } = await apiClient.patch<Floor>(`/floors/${id}`, payload);
  return data;
}

/** Delete a floor, or deactivate it when it is referenced. */
export async function deleteFloor(id: string): Promise<DeleteResult> {
  const { data } = await apiClient.delete<DeleteResult>(`/floors/${id}`);
  return data;
}

/** One page of a floor's seats, ordered by code. */
export async function listSeats(
  floorId: string,
  params: { include_inactive?: boolean; seat_type?: SeatType; page_size?: number } = {},
): Promise<Page<Seat>> {
  const { data } = await apiClient.get<Page<Seat>>(`/floors/${floorId}/seats`, { params });
  return data;
}

/** Add one seat to a floor. Admin only. */
export async function createSeat(floorId: string, payload: SeatPayload): Promise<Seat> {
  const { data } = await apiClient.post<Seat>(`/floors/${floorId}/seats`, payload);
  return data;
}

/**
 * Add many seats at once, from a pasted list of codes.
 *
 * Codes the floor already has come back in `skipped_codes` rather than failing
 * the request, so re-pasting a list is safe.
 */
export async function bulkCreateSeats(
  floorId: string,
  payload: { codes: string[]; seat_type: SeatType },
): Promise<SeatBulkResult> {
  const { data } = await apiClient.post<SeatBulkResult>(
    `/floors/${floorId}/seats/bulk`,
    payload,
  );
  return data;
}

/** Apply a partial update to a seat. A seat cannot change floor. */
export async function updateSeat(
  id: string,
  payload: Partial<SeatPayload> & { is_active?: boolean },
): Promise<Seat> {
  const { data } = await apiClient.patch<Seat>(`/seats/${id}`, payload);
  return data;
}

/** Delete a seat, or deactivate it when incidents point at it. */
export async function deleteSeat(id: string): Promise<DeleteResult> {
  const { data } = await apiClient.delete<DeleteResult>(`/seats/${id}`);
  return data;
}
