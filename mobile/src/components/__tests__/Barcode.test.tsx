import React from 'react';
import {render} from '@testing-library/react-native';
import Barcode, {canEncodeCode128B} from '../Barcode';

describe('canEncodeCode128B', () => {
  it('accepts printable ASCII (Set B range 32-127)', () => {
    expect(canEncodeCode128B('012345')).toBe(true);
    expect(canEncodeCode128B('ABC-123')).toBe(true);
    expect(canEncodeCode128B('Hello world!')).toBe(true);
    expect(canEncodeCode128B('~')).toBe(true);
  });

  it('rejects control chars (below 32)', () => {
    expect(canEncodeCode128B('A\tB')).toBe(false);
    expect(canEncodeCode128B('\n')).toBe(false);
  });

  it('rejects extended unicode (above 127)', () => {
    // Non-ASCII chars trip the spec — important so the renderer doesn't
    // silently draw a barcode that scanners would refuse.
    expect(canEncodeCode128B('café')).toBe(false);
    expect(canEncodeCode128B('日本')).toBe(false);
  });

  it('rejects empty strings', () => {
    expect(canEncodeCode128B('')).toBe(false);
  });
});

describe('<Barcode />', () => {
  it('renders bars for a valid value (smoke)', () => {
    const tree = render(<Barcode value="012345" />).toJSON();
    // SVG-based render — react-native-svg mocks resolve to host components.
    // We just want to confirm the component does NOT short-circuit to the
    // "No barcode" placeholder for a valid value.
    const flat = JSON.stringify(tree);
    expect(flat).not.toContain('No barcode');
  });

  it('shows placeholder for an unencodable value', () => {
    const tree = render(<Barcode value="café" />).toJSON();
    const flat = JSON.stringify(tree);
    expect(flat).toContain('No barcode');
  });

  it('shows placeholder for an empty value', () => {
    const tree = render(<Barcode value="" />).toJSON();
    const flat = JSON.stringify(tree);
    expect(flat).toContain('No barcode');
  });
});
