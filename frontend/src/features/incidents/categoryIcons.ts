import ApartmentIcon from '@mui/icons-material/Apartment';
import AppsIcon from '@mui/icons-material/Apps';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import ComputerIcon from '@mui/icons-material/Computer';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import HelpOutlinedIcon from '@mui/icons-material/HelpOutlined';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import MeetingRoomIcon from '@mui/icons-material/MeetingRoom';
import WifiIcon from '@mui/icons-material/Wifi';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import type { ComponentType } from 'react';

/**
 * Which Material UI icons a category group may use.
 *
 * `categories.icon` holds an icon *name* — "Computer", "Wifi" — chosen by an
 * admin on the Categories screen. Turning a name into a component needs a
 * lookup, and the lookup is explicit rather than dynamic on purpose:
 * `import * as icons from '@mui/icons-material'` would pull several thousand
 * components into the bundle to use five of them, and a `React.lazy` per name
 * would flash an empty square on the screen that opens the questionnaire.
 *
 * The cost is that a name outside this table falls back to a question mark.
 * That is the right failure — an unknown icon is a cosmetic gap, and the group
 * card still carries its name and hint. To offer another, add it here and it
 * appears in the admin's picker.
 *
 * Data rather than a component, in its own module, so that `CategoryIcon.tsx`
 * exports nothing but a component and keeps Fast Refresh.
 */
const ICONS: Record<string, ComponentType<SvgIconProps>> = {
  Apartment: ApartmentIcon,
  Apps: AppsIcon,
  CleaningServices: CleaningServicesIcon,
  Computer: ComputerIcon,
  HealthAndSafety: HealthAndSafetyIcon,
  LocalShipping: LocalShippingIcon,
  MeetingRoom: MeetingRoomIcon,
  Wifi: WifiIcon,
};

/** Icon names this application can render, for the admin's picker. */
export const CATEGORY_ICON_NAMES = Object.keys(ICONS);

/** The component for an icon name, or the fallback for one we do not have. */
export function categoryIconComponent(
  name: string | null | undefined,
): ComponentType<SvgIconProps> {
  return (name && ICONS[name]) || HelpOutlinedIcon;
}
