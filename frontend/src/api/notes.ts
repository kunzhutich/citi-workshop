import { apiClient } from './client';
import type { DeleteResult, Note, NoteVisibility } from './types';

/**
 * Notes on an incident.
 *
 * Reading them is not here: the detail page reads notes through
 * `fetchActivity`, which merges them with events into one timeline. These are
 * the writes.
 */

/** Add a note. INTERNAL is staff-only and never reaches an employee. */
export async function createNote(
  incidentId: string,
  payload: { body: string; visibility: NoteVisibility },
): Promise<Note> {
  const { data } = await apiClient.post<Note>(`/incidents/${incidentId}/notes`, payload);
  return data;
}

/** Edit a note's body, within the edit window or as an admin. */
export async function updateNote(noteId: string, body: string): Promise<Note> {
  const { data } = await apiClient.patch<Note>(`/notes/${noteId}`, { body });
  return data;
}

/** Soft-delete a note, within the edit window or as an admin. */
export async function deleteNote(noteId: string): Promise<DeleteResult> {
  const { data } = await apiClient.delete<DeleteResult>(`/notes/${noteId}`);
  return data;
}
