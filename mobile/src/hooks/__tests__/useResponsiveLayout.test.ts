import {renderHook} from '@testing-library/react-native';

import {
  classifyWidth,
  COMPACT_MAX,
  REGULAR_MAX,
  useResponsiveLayout,
} from '../useResponsiveLayout';

const mockDimensions = jest.fn();

jest.mock('react-native', () => ({
  useWindowDimensions: () => mockDimensions(),
}));

describe('classifyWidth', () => {
  it('treats anything under the compact ceiling as a phone', () => {
    expect(classifyWidth(0)).toBe('compact');
    expect(classifyWidth(320)).toBe('compact');
    expect(classifyWidth(414)).toBe('compact');
    expect(classifyWidth(COMPACT_MAX - 1)).toBe('compact');
  });

  it('treats the [600, 900) band as regular (iPad mini portrait)', () => {
    expect(classifyWidth(COMPACT_MAX)).toBe('regular');
    expect(classifyWidth(744)).toBe('regular'); // iPad mini portrait
    expect(classifyWidth(820)).toBe('regular'); // iPad 10.9 portrait
    expect(classifyWidth(REGULAR_MAX - 1)).toBe('regular');
  });

  it('treats >= 900pt as wide (iPad landscape / iPad Pro)', () => {
    expect(classifyWidth(REGULAR_MAX)).toBe('wide');
    expect(classifyWidth(1133)).toBe('wide'); // iPad mini landscape
    expect(classifyWidth(1366)).toBe('wide'); // iPad Pro 12.9 landscape
  });
});

describe('useResponsiveLayout', () => {
  afterEach(() => {
    mockDimensions.mockReset();
  });

  it('returns compact + isTablet=false for an iPhone width', () => {
    mockDimensions.mockReturnValue({width: 390, height: 844});
    const {result} = renderHook(() => useResponsiveLayout());
    expect(result.current.widthClass).toBe('compact');
    expect(result.current.isTablet).toBe(false);
    expect(result.current.width).toBe(390);
    expect(result.current.height).toBe(844);
  });

  it('returns regular + isTablet=true for iPad mini portrait', () => {
    mockDimensions.mockReturnValue({width: 744, height: 1133});
    const {result} = renderHook(() => useResponsiveLayout());
    expect(result.current.widthClass).toBe('regular');
    expect(result.current.isTablet).toBe(true);
  });

  it('returns wide + isTablet=true for iPad landscape', () => {
    mockDimensions.mockReturnValue({width: 1133, height: 744});
    const {result} = renderHook(() => useResponsiveLayout());
    expect(result.current.widthClass).toBe('wide');
    expect(result.current.isTablet).toBe(true);
  });
});
