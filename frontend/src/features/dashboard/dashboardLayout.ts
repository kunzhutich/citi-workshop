/**
 * Which sections of the admin dashboard are shown, and in what order.
 *
 * §5.2 of the redesign brief: *"Let the admin hide sections they do not use,
 * and reorder them. Persist the choice per user."*
 *
 * ## Where it is kept, and what that costs
 *
 * `localStorage`, keyed on the user's id. **Not a database table**, which is
 * the owner's call and is recorded as a limitation rather than pretended away:
 * a preference in `localStorage` belongs to one browser on one machine. An
 * admin who arranges this dashboard on a laptop and opens it on a desktop gets
 * the default arrangement there.
 *
 * What it is *not* is fragile. `localStorage` does not expire; it survives
 * reloads, restarts and upgrades, and is lost only when site data is cleared
 * or a different browser is used. Nobody has to redo this weekly.
 *
 * The API side — a `user_preferences` row and an endpoint — is on the list in
 * the README's known limitations. Moving to it later changes this file and
 * nothing else, which is why the rest of the dashboard talks to
 * {@link resolveSections} and never to storage.
 *
 * ## Reordering is constrained to a scope, deliberately
 *
 * The dashboard shows two kinds of number under one filter bar — figures for
 * the selected **period**, and figures about **right now** — and the whole
 * reason `AdminDashboardPage` is shaped the way it is, and the reason the API
 * has two dependencies instead of one, is that confusing the two is
 * catastrophic (D9, D10). A section can be hidden, and can move among its own
 * kind. It cannot cross the heading that says which kind it is.
 */

/** Which half of the dashboard a section belongs under. */
export type SectionScope = 'period' | 'current';

export interface DashboardSection {
  id: string;
  /** What the customise dialog calls it. */
  label: string;
  scope: SectionScope;
}

/**
 * Every section, in the order a fresh account sees them.
 *
 * Adding one here is all it takes: a stored arrangement that predates it lists
 * ids it does not know about, and {@link resolveSections} appends the
 * newcomers in this order rather than dropping them. A section that vanished
 * because somebody's saved layout was written last month would be the worst
 * failure this feature could have.
 */
export const DASHBOARD_SECTIONS: readonly DashboardSection[] = [
  { id: 'flow', label: 'Reported and closed, by day', scope: 'period' },
  { id: 'breakdowns', label: 'Status, priority, category and building', scope: 'period' },
  { id: 'response-times', label: 'How fast the team reacted', scope: 'period' },
  { id: 'communication', label: 'Whether people were kept informed', scope: 'period' },
  { id: 'workload', label: 'Engineer workload', scope: 'period' },
  { id: 'needs-attention', label: 'Needs attention', scope: 'current' },
  { id: 'blocked-reasons', label: 'Why tickets are blocked', scope: 'current' },
];

/*
 * The two headline tile rows are deliberately not in this list.
 *
 * "Reported in this period" and "Right now" are the answer to "how is the
 * queue doing", which is what the screen is for, and they are what each scope
 * heading introduces. A dashboard where every section can be turned off can be
 * turned into a blank page, and the admin who does that by accident has
 * nothing left on screen to tell them what went missing. They render always,
 * above whatever this list is arranged into.
 */

/** What is written to storage. */
export interface DashboardLayout {
  /** Section ids, in the admin's order. Unknown ids are ignored on read. */
  order: string[];
  /** Section ids the admin has turned off. */
  hidden: string[];
}

export const DEFAULT_LAYOUT: DashboardLayout = { order: [], hidden: [] };

/**
 * The storage key for one account.
 *
 * Keyed on the user id, so two people using one browser — which is exactly
 * what a demonstration does — do not inherit each other's arrangement.
 */
export function layoutStorageKey(userId: string): string {
  return `acme.dashboard.layout.${userId}`;
}

/**
 * Read an arrangement, refusing anything that is not one.
 *
 * Storage is not ours in the way a variable is: it survives upgrades, it can
 * be edited from the console, and an older build may have written a different
 * shape. Every field is checked, and a value that fails any check is discarded
 * in favour of the default rather than half-applied — a dashboard in a state
 * no code produced is harder to explain than one that forgot a preference.
 */
export function readLayout(userId: string): DashboardLayout {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(layoutStorageKey(userId));
  } catch {
    // Private browsing, blocked site data, or no storage at all. The dashboard
    // works without a saved arrangement; it must not fail to render for the
    // want of one.
    return DEFAULT_LAYOUT;
  }
  if (raw === null) {
    return DEFAULT_LAYOUT;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return DEFAULT_LAYOUT;
    }
    const { order, hidden } = parsed as { order?: unknown; hidden?: unknown };
    return {
      order: onlyKnownIds(order),
      hidden: onlyKnownIds(hidden),
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/** Write an arrangement, and say nothing if storage refuses. */
export function writeLayout(userId: string, layout: DashboardLayout): void {
  try {
    window.localStorage.setItem(layoutStorageKey(userId), JSON.stringify(layout));
  } catch {
    // Quota, or a browser that does not allow it. The arrangement still
    // applies for this visit; it simply will not be there next time, which is
    // a smaller problem than a dashboard that throws while being customised.
  }
}

/** Strings that name a section we actually have. */
function onlyKnownIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const known = new Set(DASHBOARD_SECTIONS.map((section) => section.id));
  return value.filter((entry): entry is string => typeof entry === 'string' && known.has(entry));
}

export interface ResolvedSection extends DashboardSection {
  visible: boolean;
}

/**
 * The catalogue arranged the way this admin wants it.
 *
 * Sections the stored order does not mention are appended **in catalogue
 * order, within their own scope** — so a section added by a later release
 * shows up where its author put it rather than at the bottom of the page or
 * not at all.
 */
export function resolveSections(layout: DashboardLayout): ResolvedSection[] {
  const hidden = new Set(layout.hidden);
  const byId = new Map(DASHBOARD_SECTIONS.map((section) => [section.id, section]));

  const ordered: DashboardSection[] = [];
  for (const id of layout.order) {
    const section = byId.get(id);
    if (section !== undefined && !ordered.includes(section)) {
      ordered.push(section);
    }
  }
  for (const section of DASHBOARD_SECTIONS) {
    if (!ordered.includes(section)) {
      ordered.push(section);
    }
  }

  // Scope wins over the stored order. A saved arrangement cannot put a
  // "right now" figure under the period heading, whatever it says.
  const scopeRank = (section: DashboardSection) => (section.scope === 'period' ? 0 : 1);
  ordered.sort((left, right) => scopeRank(left) - scopeRank(right));

  return ordered.map((section) => ({ ...section, visible: !hidden.has(section.id) }));
}

/**
 * Move a section one place within its own scope.
 *
 * Up/down rather than drag-and-drop. Dragging is the expected gesture and it
 * is also the one that needs a pointer, a library, and a keyboard story that
 * usually does not arrive; two buttons are reachable by Tab, announced by a
 * screen reader, and work on a phone without a long-press. The brief asks for
 * reordering and does not ask for dragging.
 */
export function moveSection(
  sections: ResolvedSection[],
  id: string,
  direction: -1 | 1,
): DashboardLayout['order'] {
  const index = sections.findIndex((section) => section.id === id);
  if (index === -1) {
    return sections.map((section) => section.id);
  }

  const target = index + direction;
  if (target < 0 || target >= sections.length) {
    return sections.map((section) => section.id);
  }
  // Refuse a swap that would cross the period/current line.
  if (sections[target].scope !== sections[index].scope) {
    return sections.map((section) => section.id);
  }

  const next = [...sections];
  [next[index], next[target]] = [next[target], next[index]];
  return next.map((section) => section.id);
}
