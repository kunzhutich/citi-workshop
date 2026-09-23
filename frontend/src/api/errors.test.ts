import { AxiosError } from 'axios';
import { describe, expect, it } from 'vitest';

import { apiError } from '../test/apiError';
import { describeError, errorCode, NETWORK_ERROR_MESSAGE } from './errors';

/**
 * Reading the API's two error shapes: the application's own
 * `{detail, code?, field?}` and FastAPI's `{detail: [{loc, msg}]}`.
 */

describe('describeError', () => {
  it('reads an application error and attaches it to its field', () => {
    const info = describeError(
      apiError(409, {
        detail: 'An account with that email already exists.',
        code: 'EMAIL_TAKEN',
        field: 'email',
      }),
      'fallback',
    );

    expect(info).toEqual({
      message: 'An account with that email already exists.',
      status: 409,
      code: 'EMAIL_TAKEN',
      fieldErrors: { email: 'An account with that email already exists.' },
    });
  });

  it('leaves an error with no field unattached', () => {
    const info = describeError(
      apiError(401, { detail: 'Incorrect email or password.', code: 'INVALID_CREDENTIALS' }),
      'fallback',
    );

    expect(info.fieldErrors).toEqual({});
    expect(info.message).toBe('Incorrect email or password.');
  });

  it('flattens FastAPI validation errors by their last loc segment', () => {
    const info = describeError(
      apiError(422, {
        detail: [
          { type: 'string_too_short', loc: ['body', 'password'], msg: 'too short' },
          { type: 'missing', loc: ['body', 'full_name'], msg: 'Field required' },
        ],
      }),
      'fallback',
    );

    expect(info.fieldErrors).toEqual({ password: 'too short', full_name: 'Field required' });
    // The summary is one of the field messages, never the unhelpful fallback.
    expect(info.message).toBe('too short');
  });

  it('keeps the first message when a field fails twice', () => {
    const info = describeError(
      apiError(422, {
        detail: [
          { loc: ['body', 'password'], msg: 'too short' },
          { loc: ['body', 'password'], msg: 'also wrong' },
        ],
      }),
      'fallback',
    );

    expect(info.fieldErrors).toEqual({ password: 'too short' });
  });

  it('names the network as the problem when no response arrived', () => {
    expect(describeError(new AxiosError('Network Error'), 'fallback')).toEqual({
      message: NETWORK_ERROR_MESSAGE,
      fieldErrors: {},
    });
  });

  it('falls back when the API said nothing useful', () => {
    expect(describeError(apiError(500, {}), 'Something went wrong.').message).toBe(
      'Something went wrong.',
    );
  });

  it('falls back for anything that is not an axios error at all', () => {
    expect(describeError(new Error('boom'), 'Something went wrong.')).toEqual({
      message: 'Something went wrong.',
      fieldErrors: {},
    });
  });
});

describe('errorCode', () => {
  it('returns the machine-readable code', () => {
    const error = apiError(403, {
      detail: 'You must change your password before continuing.',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });

    expect(errorCode(error)).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('returns undefined when there is none', () => {
    expect(errorCode(new Error('boom'))).toBeUndefined();
  });
});
