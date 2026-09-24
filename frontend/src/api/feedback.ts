import { apiClient } from './client';
import type { Feedback } from './types';

/**
 * The rating a reporter leaves on a repair.
 *
 * Reading them is not here, for the same reason it is not in `notes.ts`: the
 * detail page reads ratings through `fetchActivity`, which merges them with
 * the events and the notes into one timeline. These are the writes.
 *
 * Neither call names the engineer being rated or which repair is being rated.
 * Both are read from the ticket by `services/feedback.py` — a client that
 * could name them could move a bad review onto a colleague.
 */

export interface FeedbackPayload {
  /** 1 to 5, low to high. */
  rating: number;
  /** Required on every rating, not only on low ones. */
  comment: string;
}

/** Rate the current repair on a ticket. The reporter only. */
export async function createFeedback(
  incidentId: string,
  payload: FeedbackPayload,
): Promise<Feedback> {
  const { data } = await apiClient.post<Feedback>(`/incidents/${incidentId}/feedback`, payload);
  return data;
}

/** Correct a rating, within fifteen minutes of leaving it. */
export async function updateFeedback(
  feedbackId: string,
  payload: FeedbackPayload,
): Promise<Feedback> {
  const { data } = await apiClient.patch<Feedback>(`/feedback/${feedbackId}`, payload);
  return data;
}
