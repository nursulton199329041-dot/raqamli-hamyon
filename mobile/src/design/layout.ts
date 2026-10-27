import { useWindowDimensions } from 'react-native';

/**
 * Responsive layout rules, one place for every screen.
 *  - mobile  (< 768):   floating tab bar, single column, full width minus gutters
 *  - tablet  (768–1199): floating tab bar (centred, capped), 2-column statistic grids, content capped at 960
 *  - desktop (>= 1200): left sidebar navigation, content centred and capped at 1180
 * Width comes from `useWindowDimensions` (updates on resize / rotation / browser zoom), never `Dimensions.get` at module load.
 */
export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

export const BREAKPOINTS = { tablet: 768, desktop: 1200 } as const;
export const CONTENT_MAX = { mobile: Infinity, tablet: 960, desktop: 1180 } as const;
export const SIDEBAR_W = 232;
/** floating tab bar height incl. its margin; content must leave this much room at the bottom */
export const TAB_BAR_SPACE = 96;

export function breakpointOf(width: number): Breakpoint {
  if (width >= BREAKPOINTS.desktop) return 'desktop';
  if (width >= BREAKPOINTS.tablet) return 'tablet';
  return 'mobile';
}

export interface Layout {
  bp: Breakpoint;
  width: number;
  /** navigation is a left sidebar (desktop) instead of the floating bottom bar */
  sidebar: boolean;
  /** bottom padding scrollable content needs so the floating bar never covers it */
  bottomSpace: number;
  /** horizontal page gutter */
  gutter: number;
  /** columns for statistic / chart cards */
  cardColumns: 1 | 2 | 3;
}

export function layoutFor(width: number): Layout {
  const bp = breakpointOf(width);
  return {
    bp,
    width,
    sidebar: bp === 'desktop',
    bottomSpace: bp === 'desktop' ? 32 : TAB_BAR_SPACE,
    gutter: bp === 'mobile' ? 12 : 24,
    cardColumns: bp === 'desktop' ? 3 : bp === 'tablet' ? 2 : 1,
  };
}

export function useScreenLayout(): Layout {
  return layoutFor(useWindowDimensions().width);
}
