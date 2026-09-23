import { z } from 'zod';

/**
 * What the report questionnaire requires before it will submit.
 *
 * A **cache for fast feedback**, exactly as the auth schemas are: the API
 * re-checks every rule here, and when the two disagree the API wins and the
 * reporter sees its message attached to the field it named. The bounds are
 * copied from `app/schemas/incident.py`, which is the authority.
 *
 * What is deliberately *not* here: which location fields a category group
 * requires. That depends on the group's `location_detail`, which is data the
 * form loads rather than a constant it can mirror, so the check is built
 * against the loaded group instead — see `validateReport`.
 */

/** From `IncidentTitle` in `app/schemas/incident.py`. */
export const TITLE_MIN_LENGTH = 5;
export const TITLE_MAX_LENGTH = 120;

/** From `IncidentDescription` in `app/schemas/incident.py`. */
export const DESCRIPTION_MIN_LENGTH = 10;
export const DESCRIPTION_MAX_LENGTH = 5000;

export const reportTextSchema = z.object({
  title: z
    .string()
    .trim()
    .min(TITLE_MIN_LENGTH, `Give it a title of at least ${TITLE_MIN_LENGTH} characters.`)
    .max(TITLE_MAX_LENGTH, `Keep the title under ${TITLE_MAX_LENGTH} characters.`),
  description: z
    .string()
    .trim()
    .min(
      DESCRIPTION_MIN_LENGTH,
      `Describe the problem in at least ${DESCRIPTION_MIN_LENGTH} characters.`,
    )
    .max(DESCRIPTION_MAX_LENGTH, `Keep the description under ${DESCRIPTION_MAX_LENGTH} characters.`),
});

export type ReportText = z.infer<typeof reportTextSchema>;
