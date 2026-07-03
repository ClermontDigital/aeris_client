import React from 'react';
import {render} from '@testing-library/react-native';
import {Platform} from 'react-native';
import KeyboardDoneAccessory from '../KeyboardDoneAccessory';

describe('KeyboardDoneAccessory', () => {
  const original = Platform.OS;
  afterEach(() => {
    Platform.OS = original;
  });

  it('renders a Done affordance on iOS', () => {
    Platform.OS = 'ios';
    const {getByLabelText} = render(
      <KeyboardDoneAccessory nativeID="test-bar" />,
    );
    expect(getByLabelText('Dismiss keyboard')).toBeTruthy();
  });

  it('renders nothing on Android (system keyboard dismisses itself)', () => {
    Platform.OS = 'android';
    const {queryByLabelText} = render(
      <KeyboardDoneAccessory nativeID="test-bar" />,
    );
    expect(queryByLabelText('Dismiss keyboard')).toBeNull();
  });
});
