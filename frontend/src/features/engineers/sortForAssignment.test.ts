import { describe, expect, it } from 'vitest';

import { makeEngineerRow } from '../../test/factories';
import { sortForAssignment } from './hooks';

/**
 * The order the assign dialog offers engineers in.
 *
 * Specialty match first, then lowest current load. An admin assigning a
 * network problem wants the network engineers at the top and, among those, the
 * one with room — an alphabetical list makes them read every row and do that
 * arithmetic themselves.
 */
const NETWORK = 'group-network';
const HARDWARE = 'group-hardware';

describe('sortForAssignment', () => {
  it('puts a specialty match above someone with a lighter load', () => {
    const specialist = makeEngineerRow({
      user_id: 'a',
      full_name: 'Alex',
      specialty_group_ids: [NETWORK],
      active_ticket_count: 7,
    });
    const idleGeneralist = makeEngineerRow({
      user_id: 'b',
      full_name: 'Blake',
      specialty_group_ids: [HARDWARE],
      active_ticket_count: 0,
    });

    const ordered = sortForAssignment([idleGeneralist, specialist], NETWORK);

    expect(ordered.map((engineer) => engineer.full_name)).toEqual(['Alex', 'Blake']);
  });

  it('breaks a tie on specialty with the lighter load', () => {
    const busy = makeEngineerRow({
      user_id: 'a',
      full_name: 'Alex',
      specialty_group_ids: [NETWORK],
      active_ticket_count: 9,
    });
    const free = makeEngineerRow({
      user_id: 'b',
      full_name: 'Blake',
      specialty_group_ids: [NETWORK],
      active_ticket_count: 1,
    });

    const ordered = sortForAssignment([busy, free], NETWORK);

    expect(ordered.map((engineer) => engineer.full_name)).toEqual(['Blake', 'Alex']);
  });

  it('breaks a tie on load by name, so the order is stable between renders', () => {
    const zoe = makeEngineerRow({ user_id: 'a', full_name: 'Zoe', active_ticket_count: 2 });
    const ada = makeEngineerRow({ user_id: 'b', full_name: 'Ada', active_ticket_count: 2 });

    expect(sortForAssignment([zoe, ada], null).map((e) => e.full_name)).toEqual(['Ada', 'Zoe']);
  });

  it('falls back to load alone when the ticket has no group', () => {
    const busy = makeEngineerRow({ user_id: 'a', full_name: 'Alex', active_ticket_count: 5 });
    const free = makeEngineerRow({ user_id: 'b', full_name: 'Blake', active_ticket_count: 0 });

    expect(sortForAssignment([busy, free], null).map((e) => e.full_name)).toEqual([
      'Blake',
      'Alex',
    ]);
  });

  it('keeps someone unavailable in the list', () => {
    // Assigning to someone on leave is allowed, sometimes right, and the API
    // returns a warning rather than a refusal. Hiding them would make the
    // dialog disagree with the endpoint behind it.
    const onLeave = makeEngineerRow({
      user_id: 'a',
      full_name: 'Alex',
      availability: 'ON_LEAVE',
      specialty_group_ids: [NETWORK],
      active_ticket_count: 0,
    });
    const available = makeEngineerRow({
      user_id: 'b',
      full_name: 'Blake',
      availability: 'AVAILABLE',
      specialty_group_ids: [NETWORK],
      active_ticket_count: 3,
    });

    const ordered = sortForAssignment([available, onLeave], NETWORK);

    expect(ordered).toHaveLength(2);
    expect(ordered[0].full_name).toBe('Alex');
  });

  it('does not reorder the array it was given', () => {
    const first = makeEngineerRow({ user_id: 'a', full_name: 'Zoe', active_ticket_count: 9 });
    const second = makeEngineerRow({ user_id: 'b', full_name: 'Ada', active_ticket_count: 0 });
    const input = [first, second];

    sortForAssignment(input, null);

    expect(input[0].full_name).toBe('Zoe');
  });
});
