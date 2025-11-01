# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aeris is a cross-platform Electron desktop application that provides a native wrapper for the Aeris ERP Point of Sale system. The app connects to an Aeris ERP server (default: `aeris.local`, configurable to IP addresses) and provides a secure, feature-rich desktop experience.

## Development Commands

### Basic Development
- `npm run dev` - Start development mode with DevTools
- `npm start` - Start production mode
- `npm install` - Install dependencies

### Building & Distribution
- `npm run build` - Build for current platform
- `npm run build:mac` - Build macOS version (generates .dmg)
- `npm run build:win` - Build Windows version (generates .exe)
- `npm run dist` - Build without publishing

### Testing
- `npm test` - Run all tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report
- `npm run test:verbose` - Run tests with verbose output

**Test Coverage:**
- 121 tests across 3 test suites
- 92.4% overall code coverage
- 100% pass rate

### CI/CD
The project uses GitHub Actions for automated building and releases:
- Triggers on `release` branch pushes and pull requests
- **Test Phase**: Runs full test suite with coverage before building
- **Build Phase**: Only runs if all tests pass
- Builds for both macOS (Intel/ARM64) and Windows
- Automatically creates GitHub releases with version from package.json
- Uploads coverage reports as artifacts (7-day retention)
- Supports macOS notarization (requires APPLE_ID, APPLE_ID_PASS, APPLE_TEAM_ID env vars)

## Architecture

### Core Files Structure
```
src/
├── main.js           # Main Electron process - window management, IPC handlers
├── preload.js        # Secure bridge between main and renderer processes
├── session-manager.js # Multi-user session management with encryption
└── assets/icons/     # Application icons (icon.png, icon.ico, icon.icns)
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