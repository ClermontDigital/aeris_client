# Aeris ERP Client

A cross-platform desktop application for accessing the Aeris ERP Point of Sale system, built with Electron.

## Features

- **Multi-User Session Management**: PIN-protected user sessions with auto-lock timeout
- **Seamless Integration**: Loads your Aeris ERP web application in a native desktop environment
- **Configurable Server**: Connect to any Aeris ERP server (default: aeris.local, IP configurable)
- **Dual Operating Modes**: Single-user or multi-user session management
- **Secure**: AES-256-GCM encryption for PIN storage, context isolation, sandboxed renderer
- **Offline Handling**: Graceful error handling when the server is unavailable
- **Auto-Start Option**: Configure the app to start automatically with your computer
- **Cross-Platform**: Works on Windows and macOS (Intel/ARM64)
- **Full-Screen Ready**: Optimized for point-of-sale operations
- **Native Menus**: Keyboard shortcuts and native menu integration
- **Print Support**: Full printing functionality with network printer support
- **Clean Interface**: Simple, focused design for ERP operations

## Installation

### Prerequisites

- Node.js (version 16 or higher)
- npm or yarn

### Setup

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Add your application icons:
   - Place `icon.png` (512x512px) in `src/assets/icons/`
   - Place `icon.ico` (Windows format) in `src/assets/icons/`
   - Place `icon.icns` (macOS format) in `src/assets/icons/`

## Development

### Running in Development Mode

```bash
npm run dev
```

### Testing

Run automated tests:
```bash
npm test                # Run all tests
npm run test:coverage   # Run with coverage report
npm run test:watch      # Run in watch mode
```

**Test Coverage:**
- 92.4% overall code coverage
- 121 passing tests (100% pass rate)
- See [Automated Testing Guide](docs/TESTING_AUTOMATED.md) for details

### Building for Production

Build for current platform:
```bash
npm run build
```

Build for Windows:
```bash
npm run build:win
```

Build for macOS:
```bash
npm run build:mac
```

Built applications will be available in the `dist/` directory.

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

## Documentation

- **[Development Guide](docs/CLAUDE.md)** - Project overview, architecture, and development commands
- **[Testing Guide](docs/TESTING.md)** - Comprehensive manual test procedures
- **[Automated Testing](docs/TESTING_AUTOMATED.md)** - Automated test suite guide (121 tests, 92.4% coverage)
- **[TDD Review](docs/TDD_REVIEW.md)** - Test-driven development analysis and recommendations
- **[CI/CD Pipeline](docs/CICD.md)** - Continuous integration and deployment documentation

## Technical Details

### Architecture

- **Main Process**: `src/main.js` - Manages application lifecycle, windows, and IPC handlers
- **Session Manager**: `src/session-manager.js` - Multi-user session management with encryption
- **Renderer Process**: Loads the Aeris ERP web application in isolated context
- **Preload Script**: `src/preload.js` - Secure IPC communication bridge
- **Settings Storage**: Persistent configuration using electron-store

### Security

- Context isolation enabled
- Node integration disabled in renderer
- AES-256-GCM encryption for PIN storage
- PIN attempt limiting (3 attempts, 5-minute lockout)
- External links open in default browser
- Navigation restricted to configured server domain
- Secure URL validation for all external links

## Icon Requirements

Place these files in `src/assets/icons/`:

1. **icon.png** - 512x512px PNG format (main icon)
2. **icon.ico** - Windows ICO format with multiple sizes (16x16, 32x32, 48x48, 256x256)
3. **icon.icns** - macOS ICNS format

## License

MIT License - see LICENSE file for details 