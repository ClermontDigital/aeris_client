# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aeris Client is a multi-platform application suite for the Aeris ERP system:
- **Desktop** (`desktop/`): Electron app for Windows/macOS — WebView wrapper with session management, printing
- **Mobile** (`mobile/`): Expo SDK 55 / React Native app for iOS/Android — native POS screens + WebView for advanced ERP features

The apps connect to an Aeris ERP server (default: `aeris.local`, configurable). The mobile app can also connect via the Aeris Marketplace relay for secure access to on-prem deployments.

## Development Commands

### Desktop (`cd desktop`)
- `npm run dev` - Start development mode with DevTools
- `npm start` - Start production mode
- `npm test` - Run all tests (121 tests, 92.4% coverage)
- `npm run build:mac` - Build macOS .dmg
- `npm run build:win` - Build Windows .exe

### Mobile (`cd mobile`)
- `npx expo start` - Start Expo dev server
- `npm test` - Run all tests (45 tests)
- `eas build --platform ios --profile development` - Dev build (simulator)
- `eas build --platform ios --profile production --auto-submit` - Production build → TestFlight

**Important**: EAS builds must use `"image": "sdk-55"` in `eas.json` (Xcode 26.2 / Swift 6.2). Other Xcode versions fail.

### CI/CD

**Branch Strategy**:
- **Main Branch**: Development and testing (no CI/CD automation)
- **Release Branch**: Deployment trigger (full CI/CD pipeline)

The workflow uses **path-based change detection** (`dorny/paths-filter`):
- `desktop/` changes → desktop test + build (macOS/Windows/Linux) → GitHub Release
- `mobile/` changes → mobile test + EAS Build → auto-submit to TestFlight
- Both can run in parallel if both directories change

**Deployment Workflow**:
1. Work on `main` branch (development)
2. Run tests locally (`cd desktop && npm test` / `cd mobile && npm test`)
3. Merge `main` → `release` to trigger deployment
4. CI/CD runs automatically — desktop to GitHub Releases, mobile to TestFlight

**Required GitHub Secrets**: `EXPO_TOKEN`, `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_ID_PASS`, `APPLE_TEAM_ID`

## Architecture

### Desktop Core Files
```
desktop/src/
├── main.js           # Main Electron process - window management, IPC handlers
├── preload.js        # Secure bridge between main and renderer processes
├── session-manager.js # Multi-user session management with encryption
└── assets/icons/     # Application icons (icon.png, icon.ico, icon.icns)
```

### Mobile Core Files
```
mobile/src/
├── App.tsx                  # Entry point — NavigationContainer, auth gating, init
├── navigation/              # React Navigation (RootNavigator, AppTabs, stacks)
├── screens/                 # LoginScreen, DashboardScreen, QuickSaleScreen, CartScreen,
│                            # CheckoutScreen, BarcodeScannerScreen, TransactionListScreen,
│                            # ReceiptViewerScreen, ERPScreen (WebView)
├── services/
│   ├── ApiClient.ts         # Dual-mode HTTP client (direct ERP or marketplace relay)
│   ├── StorageService.ts    # Tiered storage: expo-secure-store + encrypted AsyncStorage
│   ├── EncryptionService.ts # Iterated SHA-256 key stretching, expo-crypto
│   ├── SessionManager.ts    # PIN-protected sessions with lockout
│   ├── ConnectionService.ts # Network monitoring
│   └── PrintService.ts      # expo-print + expo-sharing
├── stores/                  # Zustand: authStore, cartStore, productCacheStore, settingsStore, sessionStore
├── types/                   # api.types, navigation.types, settings.types, session.types
├── constants/               # theme (brand colors), api (endpoints + relay actions), config
└── components/              # Toolbar, WebViewContainer, PinPad, etc.
```

### Key Architecture Patterns

**Dual Operating Modes:**
- **Single-User Mode**: Direct ERP access (`enableSessionManagement: false`)
- **Multi-User Mode**: Session management with PIN-protected user switching (`enableSessionManagement: true`)

**Security Model:**
- Context isolation enabled
- Node integration disabled in renderer
- Encrypted session storage with AES-256-GCM
- PIN attempt limiting (3 attempts, 5-minute lockout)
- External link protection (opens in system browser)

**Configuration Management:**
- Uses `electron-store` for persistent settings
- Default base URL: `aeris.local` (user configurable to IP addresses)
- Settings require immediate UI updates vs. restart (documented in TESTING.md)

### IPC Communication
Main process exposes APIs via preload script:
- Settings management (`getSettings`, `saveSettings`, `testConnection`)
- Print functionality (`printPage`, `getPrinters`, `printSilent`)
- Navigation controls (`navigate`, `navigateToUrl`)  
- Dialog replacements (`showConfirmDialog`, `showAlertDialog`)
- Session management (when enabled)

### Session Manager Features
- Encrypted PIN storage with per-app encryption keys
- Session timeout management (5-120 minutes)
- Maximum 5 concurrent sessions
- Automatic session cleanup and memory management
- PIN attempt tracking with lockout protection

## Important Implementation Notes

**Default Server Configuration:**
- Base URL defaults to `aeris.local` but must support IP address override via settings
- Connection testing validates server accessibility before saving

**Settings Behavior:**
- Session management toggle: immediate effect, no restart required
- Server URL changes: require application restart
- Session timeout: immediate validation (5-120 minute range)

**Window Management:**
- Remembers window state (size, maximized status)
- Minimum size: 800x600px
- Default: 1200x800px, maximized
- Supports full-screen mode (F11)

**Print System:**
- Full printing support including network printers
- PDF export capabilities
- Silent printing options for POS operations

## Documentation

- **[Testing Guide](TESTING.md)** - Comprehensive manual test procedures
- **[TDD Review](TDD_REVIEW.md)** - Test-driven development analysis and recommendations

## Testing

Comprehensive test suite documented in [TESTING.md](TESTING.md) covers:
- Application startup in both operating modes
- Settings management and UI updates
- Session management functionality
- Print system integration
- Error handling and connection issues

The testing framework ensures all functionality works correctly across both single-user and multi-user modes, with special attention to immediate vs. restart-required setting changes.