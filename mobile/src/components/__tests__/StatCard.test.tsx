import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';
import StatCard from '../StatCard';

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
