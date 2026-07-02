import React from 'react';
import {Text} from 'react-native';
import {act, render} from '@testing-library/react-native';

import {useWorkspaceFeaturesStore} from '../../stores/workspaceFeaturesStore';

// AppTabs.tsx subscribes to `useWorkspaceFeaturesStore(s => s.repairs_enabled)`
// and gates the Repairs Tab.Screen on the resulting boolean. Mounting the
// full Tab.Navigator under jest-expo is heavy (every Tab.Screen instantiates
// a nested stack whose screens wire ApiClient + ConnectionService +
// react-native-screens; see the sibling AppTabs.test.tsx cart-badge test),
// so we render a tiny Probe component that consumes the SAME hook selector
// AppTabs uses and assert the visible output flips reactively.
const Probe: React.FC = () => {
  const enabled = useWorkspaceFeaturesStore(s => s.repairs_enabled);
  return enabled ? (
    <Text testID="repairs-tab">Repairs</Text>
  ) : (
    <Text testID="repairs-tab-hidden">hidden</Text>
  );
};

describe('AppTabs Repairs tab conditional', () => {
  beforeEach(() => {
    useWorkspaceFeaturesStore.getState().reset();
  });

  it('hides the Repairs tab when repairs_enabled is false (default)', () => {
    const {queryByTestId} = render(<Probe />);
    expect(queryByTestId('repairs-tab')).toBeNull();
    expect(queryByTestId('repairs-tab-hidden')).not.toBeNull();
  });

  it('shows the Repairs tab when repairs_enabled is true', () => {
    useWorkspaceFeaturesStore.setState({repairs_enabled: true});
    const {queryByTestId} = render(<Probe />);
    expect(queryByTestId('repairs-tab')).not.toBeNull();
    expect(queryByTestId('repairs-tab-hidden')).toBeNull();
  });

  it('re-renders reactively when the store flag flips mid-render', () => {
    const {queryByTestId} = render(<Probe />);
    expect(queryByTestId('repairs-tab-hidden')).not.toBeNull();

    act(() => {
      useWorkspaceFeaturesStore.getState().setRepairsEnabled(true);
    });
    expect(queryByTestId('repairs-tab')).not.toBeNull();

    act(() => {
      useWorkspaceFeaturesStore.getState().setRepairsEnabled(false);
    });
    expect(queryByTestId('repairs-tab-hidden')).not.toBeNull();
  });

  it('hydrateFromLogin({workspace.features.repairs_enabled: true}) lights up the tab', () => {
    const {queryByTestId} = render(<Probe />);
    expect(queryByTestId('repairs-tab')).toBeNull();

    act(() => {
      useWorkspaceFeaturesStore.getState().hydrateFromLogin({
        workspace: {features: {repairs_enabled: true}},
      });
    });
    expect(queryByTestId('repairs-tab')).not.toBeNull();
  });

  it('reset() (called from authStore.logout) hides the tab', () => {
    useWorkspaceFeaturesStore.setState({repairs_enabled: true});
    const {queryByTestId} = render(<Probe />);
    expect(queryByTestId('repairs-tab')).not.toBeNull();

    act(() => {
      useWorkspaceFeaturesStore.getState().reset();
    });
    expect(queryByTestId('repairs-tab-hidden')).not.toBeNull();
  });
});
