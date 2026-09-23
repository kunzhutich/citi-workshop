import type { SvgIconProps } from '@mui/material/SvgIcon';
import { createElement } from 'react';

import { categoryIconComponent } from './categoryIcons';

export interface CategoryIconProps extends SvgIconProps {
  /**
   * The value of `categories.icon`, which may be null or unrecognised.
   *
   * Called `iconName` rather than `name` because `SvgIconProps` already has a
   * `name` — it reaches the `<svg>` element — and the two would collide.
   */
  iconName: string | null | undefined;
}

/**
 * The icon on a category group's card. See `categoryIcons.ts` for the table.
 *
 * `createElement` rather than `<Icon />`, and that is not style. Assigning the
 * looked-up component to a capitalised local and rendering it as JSX trips
 * `react-hooks/static-components`, whose job is to catch components *defined*
 * inside a render — the mistake that remounts a subtree on every keystroke.
 * Nothing is defined here; a stable component is looked up out of a
 * module-level table. `createElement` says exactly that: render this component
 * value, which I did not make.
 */
export function CategoryIcon({ iconName, ...props }: CategoryIconProps) {
  return createElement(categoryIconComponent(iconName), props);
}
