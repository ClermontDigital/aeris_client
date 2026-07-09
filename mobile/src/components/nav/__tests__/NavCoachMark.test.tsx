import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';
import NavCoachMark from '../NavCoachMark';

describe('NavCoachMark', () => {
  it('renders the tip + Got it when visible', () => {
    const {getByText, getByLabelText} = render(
      <NavCoachMark visible onDismiss={jest.fn()} cx={200} cy={780} />,
    );
    expect(getByText('This is how you get around')).toBeTruthy();
    expect(getByLabelText('Got it')).toBeTruthy();
  });

  it('calls onDismiss from the Got it button', () => {
    const onDismiss = jest.fn();
    const {getByLabelText} = render(
      <NavCoachMark visible onDismiss={onDismiss} cx={200} cy={780} />,
    );
    fireEvent.press(getByLabelText('Got it'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss when the backdrop is tapped', () => {
    const onDismiss = jest.fn();
    const {getByLabelText} = render(
      <NavCoachMark visible onDismiss={onDismiss} cx={200} cy={780} />,
    );
    fireEvent.press(getByLabelText('Dismiss tip'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while not visible', () => {
    const {queryByText} = render(
      <NavCoachMark visible={false} onDismiss={jest.fn()} cx={200} cy={780} />,
    );
    // Modal with visible=false renders no children in the test renderer.
    expect(queryByText('This is how you get around')).toBeNull();
  });
});
