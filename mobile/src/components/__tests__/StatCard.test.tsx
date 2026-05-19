import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';
import StatCard, {pickStatRowFontSize} from '../StatCard';

describe('pickStatRowFontSize', () => {
  // The size is picked from the WIDEST value so every cell in a row
  // renders at the same scale. These tests pin the heuristic so future
  // tweaks to the size table can't silently regress the row alignment.
  it('returns the largest size (xxl=24) for short values like "0" or "$0.00"', () => {
    expect(pickStatRowFontSize(['0', '5', '$0.00'])).toBe(24);
  });

  it('scales down to 22 for "$99.99"-class values', () => {
    expect(pickStatRowFontSize(['$0.00', '$99.99', '12'])).toBe(22);
  });

  it('scales down to xl=20 for "$1,234.56"-class values', () => {
    expect(pickStatRowFontSize(['$1,234.56', '15', '$48.00'])).toBe(20);
  });

  it('scales down further for "$12,345.67"-class values', () => {
    expect(pickStatRowFontSize(['$12,345.67', '$300.00', '4'])).toBe(18);
  });

  it('handles numeric inputs alongside strings', () => {
    expect(pickStatRowFontSize([0, 5, '$0.00'])).toBe(24);
  });

  it('returns the largest size for an empty array (no values to fit)', () => {
    expect(pickStatRowFontSize([])).toBe(24);
  });

  it('treats null/undefined entries as empty strings, not as crashes', () => {
    // The caller may pass formatCurrency(undefined) -> '$NaN' or similar;
    // pickStatRowFontSize must not throw on stringifying these.
    expect(() =>
      pickStatRowFontSize([null as unknown as string, undefined as unknown as string]),
    ).not.toThrow();
  });
});

describe('StatCard', () => {
  it('renders label and value', () => {
    const {getByText} = render(<StatCard label="Sales today" value="$1,234" />);
    expect(getByText('Sales today')).toBeTruthy();
    expect(getByText('$1,234')).toBeTruthy();
  });

  it('renders sublabel when provided', () => {
    const {getByText} = render(
      <StatCard label="Items" value={42} sublabel="vs. yesterday" />,
    );
    expect(getByText('vs. yesterday')).toBeTruthy();
  });

  it('fires onPress when tapped', () => {
    const onPress = jest.fn();
    const {getByLabelText} = render(
      <StatCard label="Open" value={5} onPress={onPress} />,
    );
    fireEvent.press(getByLabelText('Open: 5'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
