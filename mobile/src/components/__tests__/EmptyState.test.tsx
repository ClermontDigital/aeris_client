import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';
import EmptyState from '../EmptyState';

describe('EmptyState', () => {
  it('renders title and description', () => {
    const {getByText} = render(
      <EmptyState
        title="No items yet"
        description="Add your first product to get started."
      />,
    );
    expect(getByText('No items yet')).toBeTruthy();
    expect(getByText('Add your first product to get started.')).toBeTruthy();
  });

  it('fires the action callback when tapped', () => {
    const onPress = jest.fn();
    const {getByText} = render(
      <EmptyState
        title="No customers"
        action={{label: 'Add customer', onPress}}
      />,
    );
    fireEvent.press(getByText('Add customer'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
