/**
 * Central registry of TanStack Query cache keys.
 *
 * Keeping them in one module means a mutation can invalidate exactly the right
 * queries without guessing at key shapes spelled out across features.
 */
export const queryKeys = {
  health: ['health'] as const,
};
