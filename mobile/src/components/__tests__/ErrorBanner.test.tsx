import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';
import ErrorBanner from '../ErrorBanner';

describe('ErrorBanner', () => {
  it('renders the message', () => {
    const {getByText} = render(<ErrorBanner message="Network error" />);
    expect(getByText('Network error')).toBeTruthy();
  });

  it('fires onRetry when Retry tapped', () => {
    const onRetry = jest.fn();
    const {getByLabelText} = render(
      <ErrorBanner message="Failed to load" onRetry={onRetry} />,
    );
    fireEvent.press(getByLabelText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('fires onDismiss when the X button is tapped', () => {
    const onDismiss = jest.fn();
    const {getByLabelText} = render(
      <ErrorBanner message="Soft warning" tone="warning" onDismiss={onDismiss} />,
    );
    fireEvent.press(getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
