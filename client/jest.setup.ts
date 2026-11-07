import '@testing-library/jest-dom';
import { TextDecoder, TextEncoder } from 'util';

// React Router 7 uses TextEncoder/TextDecoder at import time. Chromium (the real
// renderer) has them; jest-environment-jsdom 29 doesn't, so provide Node's.
Object.assign(globalThis, { TextEncoder, TextDecoder });
