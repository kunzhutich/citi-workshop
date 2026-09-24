import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { backendEnums as backend } from '../test/backendEnums';

/**
 * Every enum this application mirrors, pinned to the one it mirrors.
 *
 * ## The defect this exists to prevent, which has already happened once
 *
 * `api/types.ts` declares a hand-written union for each `StrEnum` in
 * `app/models/enums.py`, and a dozen `Record<ThatUnion, …>` maps across the
 * frontend key off them — icons, labels, chip colours, the workflow stepper's
 * step index. The `Record` is *exhaustive*, deliberately: adding a member
 * without deciding what it looks like is meant to be a compile error rather
 * than a blank square on somebody's screen.
 *
 * It is exhaustive **against the union**, and the union is a hand-written copy
 * of something in another language. S4 added `WATCHED_RESOLVED` to the backend
 * enum and nobody added it here, so the union still had four members, the
 * `Record` was still complete against four members, `tsc` was satisfied, every
 * test passed — and the notification inbox threw *"Element type is invalid"*
 * the moment a row of the new kind reached it, because the icon lookup
 * returned `undefined` and React was asked to render it.
 *
 * No amount of care inside `frontend/` could have caught that. The two halves
 * are separate languages and separate type systems; the only thing that can
 * see both is a test that reads both.
 *
 * ## Why it reads the sources rather than the running API
 *
 * The obvious alternative is to fetch `/api/v1/openapi.json` and compare. That
 * is a better check of what a *deployed* pair agree on, and a worse check
 * here: it needs a server, so it cannot run in the unit suite, and it would
 * pass on a branch that has changed the enum and not yet restarted uvicorn —
 * which is exactly the moment the drift is introduced. Reading the file on
 * disk fails on the commit that creates the problem.
 *
 * Parsing Python with a regular expression is a real cost and worth naming.
 * It is tolerable only because the shape it parses is rigid, machine-checked
 * by `ruff format`, and asserted here: `EXPECTED_ENUM_COUNT` fails if the file
 * stops looking the way this parser assumes, so the parser cannot quietly
 * start finding nothing and reporting success. That is the failure mode these
 * tests are otherwise most prone to (D24, D25).
 */

/** The TypeScript mirrors. The Python side is parsed by `test/backendEnums.ts`. */
const FRONTEND_TYPES = resolve(process.cwd(), 'src/api/types.ts');

/**
 * How many `StrEnum`s the backend file holds.
 *
 * Stated so that a parser which has stopped matching anything fails loudly
 * instead of reporting that all nought enums agree. Raise it when a genuinely
 * new enum is added — and then add its mirror, which is the point.
 */
const EXPECTED_ENUM_COUNT = 12;

/**
 * Read the string members of each exported union in `api/types.ts`.
 *
 * Only unions of string literals are collected, which is what a mirror is.
 * `export type Foo = Bar | Baz` referring to other types yields nothing and is
 * therefore never claimed as a mirror.
 */
function frontendUnions(source: string): Map<string, string[]> {
  const unions = new Map<string, string[]>();
  const pattern = /export type (\w+)\s*=\s*([^;]+);/g;

  for (const [, name, body] of source.matchAll(pattern)) {
    const members = [...body.matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map(([, value]) => value);
    if (members.length > 0) {
      unions.set(name, members);
    }
  }
  return unions;
}

const frontend = frontendUnions(readFileSync(FRONTEND_TYPES, 'utf8'));

/**
 * Which union mirrors which enum.
 *
 * Written out rather than matched by name, because the names agreeing is a
 * convention and not a guarantee, and a mapping that silently skipped a pair
 * whose names had diverged would be the same class of hole this file exists to
 * close.
 */
const MIRRORS: ReadonlyArray<readonly [backendEnum: string, frontendUnion: string]> = [
  ['UserRole', 'UserRole'],
  ['EngineerLevel', 'EngineerLevel'],
  ['IncidentStatus', 'IncidentStatus'],
  ['IncidentPriority', 'IncidentPriority'],
  ['BlockedReasonType', 'BlockedReasonType'],
  ['CloseReason', 'CloseReason'],
  ['NoteVisibility', 'NoteVisibility'],
  ['AvailabilityStatus', 'AvailabilityStatus'],
  ['SeatType', 'SeatType'],
  ['LocationDetail', 'LocationDetail'],
  ['EventType', 'EventType'],
  ['NotificationType', 'NotificationType'],
];

describe('the parser itself', () => {
  it('finds every StrEnum in the backend, so agreement cannot mean "found none"', () => {
    expect(backend.size).toBe(EXPECTED_ENUM_COUNT);
    for (const [, members] of backend) {
      expect(members.length).toBeGreaterThan(0);
    }
  });

  it('finds a union for every enum it is asked to compare', () => {
    // The negative half of the same worry: a renamed or deleted union must
    // fail here rather than being skipped and counted as agreement.
    for (const [, union] of MIRRORS) {
      expect(frontend.has(union), `api/types.ts has no union ${union}`).toBe(true);
    }
  });
});

describe('a frontend union', () => {
  it.each(MIRRORS)('%s matches app.models.enums.%s member for member', (pyName, tsName) => {
    // Sorted, because the declaration order of a union is a readability choice
    // and not a contract — what must agree is the set of values that can cross
    // the wire.
    const expected = [...(backend.get(pyName) ?? [])].sort();
    const actual = [...(frontend.get(tsName) ?? [])].sort();

    expect(actual).toEqual(expected);
  });
});
