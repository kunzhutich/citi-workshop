import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The backend's `StrEnum`s, read off disk, for tests that must not lag behind.
 *
 * **Test-only, and deliberately not importable from application code.** The
 * frontend's own copy of each enum is the hand-written union in
 * `api/types.ts`; that is what ships, and it is what every `Record<Union, …>`
 * is exhaustive against. This module exists so that *tests* can assert against
 * the other side of the wire instead of against that copy — because a test
 * parametrised over the copy agrees with whatever the copy says, including
 * when the copy is wrong.
 *
 * Which it was. S4 added `WATCHED_RESOLVED` to `app/models/enums.py`, the
 * union kept its four members, `tsc` was satisfied, the suite was green, and
 * the notification inbox threw *"Element type is invalid"* for every reader
 * with a row of the new kind — the icon `Record` returned `undefined` and
 * React was handed it. `api/enumMirrors.test.ts` pins the union to this; a
 * screen test parametrised over `backendEnumMembers(…)` renders every kind
 * that can actually arrive.
 *
 * Parsing Python with a regular expression is a real cost. It is tolerable
 * because the shape is rigid and machine-checked by `ruff format`, and because
 * `enumMirrors.test.ts` asserts the parse found what it should — a parser that
 * quietly started matching nothing would otherwise report that everything
 * agrees, which is the failure mode this project has been bitten by most
 * (D24, D25).
 */

/** Where the Python enums live, from the project root Vitest runs in. */
const BACKEND_ENUMS = resolve(process.cwd(), '../backend/v1/app/models/enums.py');

/**
 * Every `class X(StrEnum)` in that file, as name → member values.
 *
 * A class body ends at the next line starting in column zero, which is what
 * `ruff format` guarantees for a top-level class. Docstrings, `#:` annotations
 * and comments are skipped by not matching the member pattern.
 */
export function parseBackendEnums(source: string): Map<string, string[]> {
  const enums = new Map<string, string[]>();
  let current: string | null = null;

  for (const line of source.split('\n')) {
    const classMatch = /^class (\w+)\(StrEnum\):/.exec(line);
    if (classMatch) {
      current = classMatch[1];
      enums.set(current, []);
      continue;
    }
    if (current === null) {
      continue;
    }
    if (line.length > 0 && !/^\s/.test(line)) {
      current = null;
      continue;
    }
    const memberMatch = /^\s{4}(\w+)\s*=\s*"([^"]+)"/.exec(line);
    if (memberMatch) {
      enums.get(current)?.push(memberMatch[2]);
    }
  }
  return enums;
}

/** Read once; the file does not change under a test run. */
export const backendEnums: ReadonlyMap<string, readonly string[]> = parseBackendEnums(
  readFileSync(BACKEND_ENUMS, 'utf8'),
);

/**
 * The members of one backend enum, for parametrising a test over.
 *
 * Throws rather than returning `[]` for a name it cannot find. An empty list
 * would turn `it.each(...)` into nought test cases, which reports as success —
 * the precise shape of quiet failure this module was written to remove.
 */
export function backendEnumMembers(name: string): string[] {
  const members = backendEnums.get(name);
  if (members === undefined || members.length === 0) {
    throw new Error(`No StrEnum named ${name} was found in ${BACKEND_ENUMS}`);
  }
  return [...members];
}
