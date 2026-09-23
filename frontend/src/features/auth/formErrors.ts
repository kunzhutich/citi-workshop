import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

import { describeError } from '../../api/errors';

/**
 * Route an API failure to the inputs that caused it.
 *
 * The API names the offending field — `{"detail": ..., "field": "email"}` for
 * its own errors, `loc: ["body", "password"]` for FastAPI's validation ones —
 * so a rejected form can highlight the input rather than showing a banner the
 * user has to map back onto a field themselves.
 *
 * Returns the message to show as a form-level alert, or `null` when every part
 * of the error landed on a field.
 */
export function applyApiErrors<TValues extends FieldValues>(
  error: unknown,
  fallback: string,
  fields: Path<TValues>[],
  setError: UseFormSetError<TValues>,
): string | null {
  const info = describeError(error, fallback);
  const known = new Set<string>(fields);
  let attached = false;

  for (const [field, message] of Object.entries(info.fieldErrors)) {
    if (!known.has(field)) {
      continue;
    }
    setError(field as Path<TValues>, { type: 'server', message });
    attached = true;
  }

  return attached ? null : info.message;
}
