import { apiClient } from './client';
import type {
  AvailabilityStatus,
  DeleteResult,
  Engineer,
  EngineerCreated,
  EngineerLevel,
  Page,
} from './types';

/**
 * Engineer accounts and their profiles.
 *
 * The API presents an engineer as one resource rather than a user plus a
 * profile, because no screen ever wants half of it: the Team page and the
 * assign dialog both need the name, the level and the workload together.
 */

/**
 * Body of `POST /engineers`.
 *
 * There is no password field. The endpoint generates a temporary one and
 * returns it once, so a password an engineer will keep never travels through
 * an admin's screen.
 */
export interface EngineerCreatePayload {
  email: string;
  full_name: string;
  level: EngineerLevel;
  specialty_group_ids: string[];
  home_building_id?: string | null;
  phone?: string | null;
  max_active_tickets: number;
}

/** Body of `PATCH /engineers/{user_id}` — an admin's partial update. */
export interface EngineerUpdatePayload {
  full_name?: string;
  level?: EngineerLevel;
  specialty_group_ids?: string[];
  home_building_id?: string | null;
  phone?: string | null;
  availability?: AvailabilityStatus;
  max_active_tickets?: number;
}

/** Filters accepted by `GET /engineers`. */
export interface EngineerQuery {
  availability?: AvailabilityStatus;
  level?: EngineerLevel;
  group_id?: string;
  building_id?: string;
  include_inactive?: boolean;
  page?: number;
  page_size?: number;
}

/**
 * One page of engineers, each with `active_ticket_count`.
 *
 * That count is computed in SQL, and it is what the capacity bars and the
 * assign dialog's ordering are built from.
 */
export async function listEngineers(query: EngineerQuery = {}): Promise<Page<Engineer>> {
  const { data } = await apiClient.get<Page<Engineer>>('/engineers', { params: query });
  return data;
}

/** One engineer, for their profile page. */
export async function getEngineer(userId: string): Promise<Engineer> {
  const { data } = await apiClient.get<Engineer>(`/engineers/${userId}`);
  return data;
}

/**
 * Create an engineer account and its profile.
 *
 * The temporary password in the response exists nowhere else — the database
 * holds only its bcrypt hash — so the screen has to show it before it is lost.
 */
export async function createEngineer(payload: EngineerCreatePayload): Promise<EngineerCreated> {
  const { data } = await apiClient.post<EngineerCreated>('/engineers', payload);
  return data;
}

/** Apply an admin's partial update to an engineer. */
export async function updateEngineer(
  userId: string,
  payload: EngineerUpdatePayload,
): Promise<Engineer> {
  const { data } = await apiClient.patch<Engineer>(`/engineers/${userId}`, payload);
  return data;
}

/**
 * Update your own availability or phone.
 *
 * Level, specialties and capacity are missing on purpose: an engineer who
 * could raise their own level could assign work to other people.
 */
export async function updateOwnProfile(payload: {
  availability?: AvailabilityStatus;
  phone?: string | null;
}): Promise<Engineer> {
  const { data } = await apiClient.patch<Engineer>('/engineers/me', payload);
  return data;
}

/** Deactivate an engineer. Accounts are never deleted. */
export async function deactivateEngineer(userId: string): Promise<DeleteResult> {
  const { data } = await apiClient.delete<DeleteResult>(`/engineers/${userId}`);
  return data;
}
