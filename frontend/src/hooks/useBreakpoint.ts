import { useMediaQuery } from 'react-responsive';

/**
 * Widest viewport still treated as mobile, in pixels.
 *
 * Aligned with Material UI's `md` breakpoint (900px) so that `react-responsive`
 * layout switching and MUI's own responsive props agree.
 */
export const MOBILE_MAX_WIDTH = 899;

export interface Breakpoint {
  isMobile: boolean;
  isDesktop: boolean;
}

/** Report which layout the current viewport should render. */
export function useBreakpoint(): Breakpoint {
  const isMobile = useMediaQuery({ maxWidth: MOBILE_MAX_WIDTH });
  return { isMobile, isDesktop: !isMobile };
}
