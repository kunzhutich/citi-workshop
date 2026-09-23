/**
 * Types mirroring the API's Pydantic schemas.
 *
 * These are hand-written rather than generated: the surface is small, and a
 * hand-written type can carry the same doc comments the Python schema does.
 * When a schema in `backend/v1/app/schemas/` changes, change its twin here.
 */

/** `app.models.enums.UserRole`. */
export type UserRole = 'EMPLOYEE' | 'ENGINEER' | 'FACILITY_ADMIN';

/** `app.models.enums.EngineerLevel`. Governs assignment rights. */
export type EngineerLevel = 'JUNIOR' | 'SENIOR' | 'LEAD';

/** `app.models.enums.AvailabilityStatus`. */
export type AvailabilityStatus = 'AVAILABLE' | 'BUSY' | 'OFF_DUTY' | 'ON_LEAVE';

/** Mirrors `EngineerProfileRead`. Present only on ENGINEER users. */
export interface EngineerProfile {
  level: EngineerLevel;
  specialty_group_ids: string[];
  home_building_id: string | null;
  phone: string | null;
  availability: AvailabilityStatus;
  max_active_tickets: number;
}

/** Mirrors `UserRead`. Never carries the password hash. */
export interface User {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  /** While true, every endpoint outside `/auth` answers 403. */
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
}

/** Mirrors `CurrentUserRead` — the caller's own record, profile included. */
export interface CurrentUser extends User {
  engineer_profile: EngineerProfile | null;
}

/**
 * Mirrors `TokenResponse`, returned by login and refresh.
 *
 * The refresh token is deliberately absent from the body: it travels only in
 * the `HttpOnly` cookie, so no JavaScript on the page can read it.
 */
export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

/** Mirrors `MeResponse`. */
export interface MeResponse {
  user: CurrentUser;
}

/** Mirrors `RegisterResponse`. Registration issues no tokens. */
export interface RegisterResponse {
  user: User;
}

/** Mirrors `MessageResponse`. */
export interface MessageResponse {
  detail: string;
}
