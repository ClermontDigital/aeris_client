import {useWindowDimensions} from 'react-native';

/**
 * Width-class buckets for responsive layout. We do NOT use Platform.isPad —
 * the hook reads live window dimensions so it responds to rotation and
 * iPad multitasking (Split View / Slide Over) correctly.
 *
 * - compact: phones (and very narrow multitasking slots)        width < 600
 * - regular: iPad mini portrait, iPhone Pro Max landscape  600 <= width < 900
 * - wide:    iPad landscape, iPad Pro                            width >= 900
 */
export type WidthClass = 'compact' | 'regular' | 'wide';

export interface ResponsiveLayout {
  width: number;
  height: number;
  widthClass: WidthClass;
  /** Convenience: any non-phone width. */
  isTablet: boolean;
}

export const COMPACT_MAX = 600;
export const REGULAR_MAX = 900;

export function classifyWidth(width: number): WidthClass {
  if (width < COMPACT_MAX) return 'compact';
  if (width < REGULAR_MAX) return 'regular';
  return 'wide';
}

export function useResponsiveLayout(): ResponsiveLayout {
  const {width, height} = useWindowDimensions();
  const widthClass = classifyWidth(width);
  return {
    width,
    height,
    widthClass,
    isTablet: widthClass !== 'compact',
  };
}
