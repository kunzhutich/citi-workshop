import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { setViewportWidth } from '../test/viewport';
import { MOBILE_MAX_WIDTH, useBreakpoint } from './useBreakpoint';

describe('useBreakpoint', () => {
  it('uses the mobile layout at or below the MUI md breakpoint', () => {
    setViewportWidth(MOBILE_MAX_WIDTH);

    expect(renderHook(() => useBreakpoint()).result.current).toEqual({
      isMobile: true,
      isDesktop: false,
    });
  });

  it('uses the desktop layout above the breakpoint', () => {
    setViewportWidth(MOBILE_MAX_WIDTH + 1);

    expect(renderHook(() => useBreakpoint()).result.current).toEqual({
      isMobile: false,
      isDesktop: true,
    });
  });

  it('treats a phone-sized viewport as mobile', () => {
    setViewportWidth(375);

    expect(renderHook(() => useBreakpoint()).result.current.isMobile).toBe(true);
  });
});
