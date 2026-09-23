import { apiClient } from './client';
import type { Page, User, UserRole } from './types';

/**
 * User administration.
 *
 * An admin may change a role and deactivate an account, and that is all. Email
 * is the sign-in identity and the key every audit trail is read by, so
 * changing it would be an account migration rather than an edit; a password
 * can only be set by its owner.
 */

/** Filters accepted by `GET /users`. */
export interface UserQuery {
  role?: UserRole;
  q?: string;
  include_inactive?: boolean;
  page?: number;
  page_size?: number;
}

/** Body of `PATCH /users/{id}`. */
export interface UserUpdatePayload {
  full_name?: string;
  role?: UserRole;
  is_active?: boolean;
}

/** One page of accounts, ordered by name. Admin only. */
export async function listUsers(query: UserQuery = {}): Promise<Page<User>> {
  const { data } = await apiClient.get<Page<User>>('/users', { params: query });
  return data;
}

/**
 * Change a user's name, role or active flag.
 *
 * Promoting someone to ENGINEER creates a default JUNIOR profile when the
 * account has none, so the new role is usable immediately.
 */
export async function updateUser(id: string, payload: UserUpdatePayload): Promise<User> {
  const { data } = await apiClient.patch<User>(`/users/${id}`, payload);
  return data;
}
