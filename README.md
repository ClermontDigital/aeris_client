# Aeris ERP Client

Cross-platform client applications for the Aeris ERP system — desktop (Electron) and mobile (React Native / Expo).

## Platforms

### Desktop (Electron)
- **Windows** and **macOS** (Intel/ARM64)
- Multi-user session management with PIN-protected switching
- Native printing and full-screen POS mode
- Auto-start, keyboard shortcuts, native menus

### Mobile (Expo / React Native)
- **iOS** (TestFlight / App Store) and **Android**
- Native login, dashboard with sales charts, product search
- Camera barcode scanner for POS operations
- Touch-optimized quick sale flow with cart and checkout
- Transaction history with native receipt viewer and print/share
- Full ERP access via WebView tab for advanced features
- Offline product catalog and sale queuing
- Connects to on-prem ERP via the Aeris Marketplace relay (secure cloud proxy)

## Features (Both Platforms)

- **Configurable Server**: Connect to any Aeris ERP server (default: aeris.local, IP configurable)
- **Dual Operating Modes**: Single-user or multi-user session management
- **Secure**: Encrypted PIN storage, hardware-backed key storage (Keychain/Keystore on mobile)
- **Offline Handling**: Graceful error handling when the server is unavailable
- **Print Support**: Full printing with network printer support
- **Clean Interface**: Focused design for ERP operations

## Quick Start

### Prerequisites

- Node.js 20+
- npm

### Desktop

```bash
cd desktop
npm install
npm run dev          # Development mode
npm test             # Run tests (121 tests, 92.4% coverage)
npm run build:mac    # Build macOS .dmg
npm run build:win    # Build Windows .exe
```

### Mobile

```bash
cd mobile
npm install
npx expo start                    # Start dev server
npm test                          # Run tests
eas build --platform ios --profile production --auto-submit   # Build + TestFlight
```

**EAS Build requires `sdk-55` image** (Xcode 26.2) — see `eas.json`.

### Building for Production

**Desktop**: Built apps in `desktop/dist/`
```bash
cd desktop && npm run build
```

**Mobile**: Builds via EAS (Expo cloud), auto-submits to TestFlight/Play Store
```bash
cd mobile && eas build --platform ios --profile production --auto-submit
```

## Configuration

### First Run

1. Launch the application
2. If your Aeris ERP server is not running on aeris.local, open Settings (Cmd/Ctrl + ,)
3. Configure your server URL
4. Test the connection
5. Optionally enable session management and auto-start

### Settings

Access settings via:
- Menu: AERIS → Settings
- Keyboard shortcut: Cmd/Ctrl + ,

Available settings:
- **Server URL**: The URL where your Aeris ERP server is running (requires restart)
- **Enable Session Management**: Toggle multi-user session mode (immediate effect)
- **Session Timeout**: Auto-lock timeout in minutes (5-120, immediate effect)
- **Auto-Start**: Start Aeris automatically when your computer starts (immediate effect)

## Keyboard Shortcuts

- **Cmd/Ctrl + ,**: Open Settings
- **Cmd/Ctrl + R**: Reload Application
- **Cmd/Ctrl + P**: Print Current Page
- **F11**: Toggle Full Screen
- **F12**: Open Developer Tools (development mode)
- **Cmd/Ctrl + Q**: Quit Application

## Troubleshooting

### Cannot Connect to Server

1. Ensure your Aeris ERP server is running
2. Check the server URL in Settings
3. Use the "Test Connection" button in Settings
4. Check your firewall settings

### Application Won't Start

1. Check that Node.js is installed
2. Verify all dependencies are installed: `npm install`
3. Try running in development mode: `npm run dev`

## Project Structure

```
aeris_client/
├── desktop/              # Electron desktop app
│   ├── src/              # Main process, preload, session manager, HTML templates
│   ├── __tests__/        # Desktop tests (121 tests, 92.4% coverage)
│   └── package.json
├── mobile/               # Expo / React Native mobile app
│   ├── src/
│   │   ├── screens/      # Native screens (Login, Dashboard, QuickSale, Cart, etc.)
│   │   ├── navigation/   # React Navigation (tabs + stacks)
│   │   ├── services/     # ApiClient, StorageService, EncryptionService, etc.
│   │   ├── stores/       # Zustand stores (auth, cart, products, settings, sessions)
│   │   ├── components/   # Shared components (Toolbar, WebView, PinPad, etc.)
│   │   ├── types/        # TypeScript types (API, navigation, settings, sessions)
│   │   └── constants/    # Theme, API endpoints, config
│   ├── plugins/          # Expo config plugins (Folly coroutines fix)
│   ├── assets/images/    # App icon, splash screen, adaptive icon
│   ├── app.json          # Expo config (bundle ID: com.aeris.erp)
│   ├── eas.json          # EAS Build profiles + TestFlight submission
│   └── package.json
└── .github/workflows/    # CI/CD (path-based: desktop or mobile builds)
```

## CI/CD

GitHub Actions workflow on the `release` branch with **path-based change detection**:
- **Desktop changes** (`desktop/`): tests → builds macOS/Windows/Linux → GitHub Release
- **Mobile changes** (`mobile/`): tests → EAS Build → auto-submit to TestFlight
- Changes to both trigger both pipelines in parallel

Required GitHub secrets: `EXPO_TOKEN`, `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_ID_PASS`, `APPLE_TEAM_ID`

## Documentation

- **[Development Guide](docs/CLAUDE.md)** - Desktop architecture, commands, and patterns
- **[Testing Guide](docs/TESTING.md)** - Manual test procedures
- **[Automated Testing](docs/TESTING_AUTOMATED.md)** - Test suite guide
- **[CI/CD Pipeline](docs/CICD.md)** - CI/CD documentation

## License

MIT License - see LICENSE file for details