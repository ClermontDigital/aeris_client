import React from 'react';
import {render} from '@testing-library/react-native';
import {View} from 'react-native';
import BarcodePreview from '../BarcodePreview';

describe('BarcodePreview', () => {
  it('renders bar Views for a valid repair number', () => {
    const {UNSAFE_getAllByType, getByLabelText} = render(
      <BarcodePreview value="REP-20260702-000001" />,
    );
    // The wrapper + coalesced run Views. Far more than a couple, well under
    // the 244 raw module count.
    const views = UNSAFE_getAllByType(View);
    expect(views.length).toBeGreaterThan(10);
    expect(views.length).toBeLessThan(140);
    // Accessibility label defaults to "Barcode for {value}".
    expect(getByLabelText('Barcode for REP-20260702-000001')).toBeTruthy();
  });

  it('honours a custom accessibility label', () => {
    const {getByLabelText} = render(
      <BarcodePreview value="REP-20260702-000001" accessibilityLabel="Repair code" />,
    );
    expect(getByLabelText('Repair code')).toBeTruthy();
  });

  it('renders nothing when the value cannot be encoded', () => {
    // é is outside CODE128B — component returns null, so no Views mount.
    const {UNSAFE_queryAllByType} = render(<BarcodePreview value="café" />);
    expect(UNSAFE_queryAllByType(View).length).toBe(0);
  });
});
