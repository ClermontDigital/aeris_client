// M-R2 / §24.2: install the WHATWG URL polyfill BEFORE any other import so the
// `isLocalUrlSafeForCache` validator (and every other `new URL(...)` call) runs
// against the SAME `URL` implementation on-device (Hermes) as it does under the
// Node/Jest test runner — otherwise "tested ≠ shipped". Must be first.
import 'react-native-url-polyfill/auto';
import { registerRootComponent } from 'expo';
import App from './src/App';

registerRootComponent(App);
