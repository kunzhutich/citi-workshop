import { AxiosError } from 'axios';

/**
 * Reading the API's two error shapes.
 *
 * The application's own errors come from `app/errors.py` as
 * `{detail, code?, field?}`. FastAPI's request-validation failures keep their
 * standard shape, `{detail: [{loc, msg, type}, ...]}`, because that carries
 * per-field detail for free. Forms need both flattened the same way, so this
 * module is the one place that knows either.
 */

/** `app/errors.py`'s rendering of a deliberate error. */
interface ApiErrorBody {
  detail?: string;
  code?: string;
  field?: string;
}

/** One entry of FastAPI's request-validation error list. */
interface ValidationErrorItem {
  loc?: (string | number)[];
  msg?: string;
}

/** An API failure, flattened into what a screen needs to render. */
export interface ApiErrorInfo {
  /** Message to show when nothing more specific fits. */
  message: string;
  /** HTTP status, absent when the request never reached the API. */
  status?: number;
  /** Machine-readable code, e.g. `PASSWORD_CHANGE_REQUIRED`. */
  code?: string;
  /** Field name → message, for attaching errors to form inputs. */
  fieldErrors: Record<string, string>;
}

/** Shown when the request never reached the API at all. */
export const NETWORK_ERROR_MESSAGE =
  'Could not reach the server. Check your connection and try again.';

/**
 * Flatten any thrown value into something a screen can render.
 *
 * `fallback` is used when the API answered but said nothing useful — a bare
 * 500, say. Callers pass a message phrased for their own screen.
 */
export function describeError(error: unknown, fallback: string): ApiErrorInfo {
  if (!(error instanceof AxiosError)) {
    return { message: fallback, fieldErrors: {} };
  }

  if (!error.response) {
    return { message: NETWORK_ERROR_MESSAGE, fieldErrors: {} };
  }

  const status = error.response.status;
  const body = error.response.data as ApiErrorBody | undefined;

  if (Array.isArray(body?.detail)) {
    const fieldErrors = collectFieldErrors(body.detail);
    return {
      message: firstMessage(fieldErrors) ?? fallback,
      status,
      fieldErrors,
    };
  }

  const message = typeof body?.detail === 'string' ? body.detail : fallback;
  return {
    message,
    status,
    code: body?.code,
    fieldErrors: body?.field ? { [body.field]: message } : {},
  };
}

/** Return the machine-readable code of an API error, if it carried one. */
export function errorCode(error: unknown): string | undefined {
  return describeError(error, '').code;
}

/**
 * Turn FastAPI's validation list into `{field: message}`.
 *
 * `loc` is a path such as `["body", "password"]`; the last segment is the
 * field name the form knows it by. The first message for a field wins, which
 * matches how a form shows one error per input.
 */
function collectFieldErrors(items: ValidationErrorItem[]): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const item of items) {
    const field = item.loc?.at(-1);
    if (typeof field !== 'string' || field === 'body' || !item.msg) {
      continue;
    }
    errors[field] ??= item.msg;
  }

  return errors;
}

/** Return any one field message, to use as the summary line. */
function firstMessage(fieldErrors: Record<string, string>): string | undefined {
  return Object.values(fieldErrors)[0];
}
