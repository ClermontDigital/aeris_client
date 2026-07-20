import {useCallback, useEffect, useRef} from 'react';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {useHeaderBackStore} from '../stores/headerBackStore';

/**
 * Registers a screen's Back handler into the shared brand-header back slot
 * (headerBackStore) so AppTabsInner shows a "Back" button while this screen is
 * focused and runs `handler` when it's tapped. Every drill-down screen
 * (ProductDetail, ProductEdit, Cart, RepairDetail, CustomerDetail,
 * SaleDetail, …) uses this so they behave identically.
 *
 * Ownership dance, encapsulated here so it can't drift per-screen:
 *   - setOnBack on focus, with a per-focus double-fire guard (a fast
 *     double-tap or a programmatic re-entry can't fire the nav twice).
 *   - Re-assert on parent-TAB focus. On Android, switching to another tab
 *     (whose root calls clearOnBack) wipes the single shared slot, and the
 *     nested screen's own focus effect does NOT reliably re-fire on the tab
 *     return (react-native-screens keeps it warm), so the Back button would
 *     stay dead. The tab navigator's own 'focus' event fires reliably;
 *     re-asserting there restores it. Guarded by isFocused() so a tab root's
 *     clearOnBack still wins once the stack has been popped to the root. (#70)
 *   - beforeRemove → identity-matched clearIf, so the slot is cleared only
 *     when THIS screen is actually removed from the stack, not on a transient
 *     blur (the v1.3.70 race fix — a popped screen's blur fires before the
 *     revealed screen's focus, so an unconditional clear would wipe the
 *     revealed screen's freshly-installed handler).
 *
 * `handler` may change identity between renders; the slot always runs the
 * latest one. The registered function itself is stable, which is what lets
 * the identity-matched clearIf work reliably.
 */
export function useHeaderBack(handler: () => void): void {
  const navigation = useNavigation();
  const setOnBack = useHeaderBackStore(s => s.setOnBack);
  const clearIf = useHeaderBackStore(s => s.clearIf);

  const firedRef = useRef(false);
  // Always call the latest handler without changing the registered slot fn's
  // identity (clearIf is identity-matched).
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  // Stable across the screen's lifetime: same reference passed to setOnBack
  // and clearIf, so beforeRemove's clearIf only ever wipes OUR own slot.
  const guarded = useRef(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    handlerRef.current();
  }).current;

  useFocusEffect(
    useCallback(() => {
      firedRef.current = false;
      setOnBack(guarded);
      return undefined;
    }, [setOnBack, guarded]),
  );

  useEffect(() => {
    const parent = navigation.getParent?.();
    if (!parent || typeof parent.addListener !== 'function') {
      return undefined;
    }
    const sub = parent.addListener('focus', () => {
      if (navigation.isFocused?.()) {
        firedRef.current = false;
        setOnBack(guarded);
      }
    });
    return sub;
  }, [navigation, setOnBack, guarded]);

  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', () => {
      clearIf(guarded);
    });
    return sub;
  }, [navigation, clearIf, guarded]);
}
