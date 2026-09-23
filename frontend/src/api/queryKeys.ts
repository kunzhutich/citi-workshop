import type { EngineerQuery } from './engineers';
import type { IncidentQuery } from './incidents';
import type { UserQuery } from './users';

/**
 * Central registry of TanStack Query cache keys.
 *
 * Every key in one module means a mutation can invalidate exactly the right
 * queries without guessing at key shapes spelled out across features — and
 * when a key shape changes, one file changes.
 *
 * The convention is a widening prefix: `['incidents']` is the prefix of
 * `['incidents', 'list', filters]`, so invalidating the former re-fetches
 * every list however it was filtered. TanStack Query matches keys by prefix,
 * which is what makes that work.
 */
export const queryKeys = {
  health: ['health'] as const,

  incidents: {
    all: ['incidents'] as const,
    list: (query: IncidentQuery) => ['incidents', 'list', query] as const,
    detail: (id: string) => ['incidents', 'detail', id] as const,
    transitions: (id: string) => ['incidents', 'detail', id, 'allowed-transitions'] as const,
    activity: (id: string) => ['incidents', 'detail', id, 'activity'] as const,
  },

  categories: {
    all: ['categories'] as const,
    tree: (includeInactive: boolean) => ['categories', 'tree', includeInactive] as const,
  },

  facilities: {
    all: ['facilities'] as const,
    tree: (includeInactive: boolean) => ['facilities', 'tree', includeInactive] as const,
    seats: (floorId: string, includeInactive: boolean) =>
      ['facilities', 'seats', floorId, includeInactive] as const,
  },

  engineers: {
    all: ['engineers'] as const,
    list: (query: EngineerQuery) => ['engineers', 'list', query] as const,
  },

  users: {
    all: ['users'] as const,
    list: (query: UserQuery) => ['users', 'list', query] as const,
  },
} as const;
