import { useCallback, useMemo, useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import {
  DEFAULT_LAYOUT,
  moveSection,
  readLayout,
  resolveSections,
  writeLayout,
  type DashboardLayout,
  type ResolvedSection,
} from './dashboardLayout';

export interface DashboardLayoutControls {
  /** Every section, in the admin's order, each saying whether it is shown. */
  sections: ResolvedSection[];
  /** Whether a section should be rendered at all. */
  isVisible: (id: string) => boolean;
  toggle: (id: string) => void;
  move: (id: string, direction: -1 | 1) => void;
  reset: () => void;
  /** Whether anything has been customised, for the dialog's Reset button. */
  isCustomised: boolean;
}

/**
 * The admin's dashboard arrangement, read once and written on every change.
 *
 * State is initialised from storage with a lazy initialiser, so the read
 * happens once per mount rather than on every render — and so the first paint
 * is already the arrangement the admin chose. Reading it in an effect instead
 * would render the default first and then rearrange the page under them,
 * which is the flicker this feature would be most criticised for.
 *
 * Every mutation writes through immediately. There is no save button, because
 * there is nothing to lose by being wrong: every change is one click to undo
 * and the dialog has a Reset.
 */
export function useDashboardLayout(): DashboardLayoutControls {
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const [layout, setLayout] = useState<DashboardLayout>(() =>
    userId === '' ? DEFAULT_LAYOUT : readLayout(userId),
  );

  const sections = useMemo(() => resolveSections(layout), [layout]);

  const apply = useCallback(
    (next: DashboardLayout) => {
      setLayout(next);
      if (userId !== '') {
        writeLayout(userId, next);
      }
    },
    [userId],
  );

  const toggle = useCallback(
    (id: string) => {
      const hidden = layout.hidden.includes(id)
        ? layout.hidden.filter((entry) => entry !== id)
        : [...layout.hidden, id];
      apply({ ...layout, hidden });
    },
    [apply, layout],
  );

  const move = useCallback(
    (id: string, direction: -1 | 1) => {
      apply({ ...layout, order: moveSection(sections, id, direction) });
    },
    [apply, layout, sections],
  );

  const reset = useCallback(() => apply(DEFAULT_LAYOUT), [apply]);

  return {
    sections,
    isVisible: useCallback(
      (id: string) => sections.find((section) => section.id === id)?.visible ?? true,
      [sections],
    ),
    toggle,
    move,
    reset,
    isCustomised: layout.order.length > 0 || layout.hidden.length > 0,
  };
}
