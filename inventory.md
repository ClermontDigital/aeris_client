# Aeris Client - Source File Inventory

## Project Structure
- **Type**: Electron Desktop Application  
- **Version**: 1.0.5
- **Main Process**: `src/main.js`
- **Renderer Process**: `src/app-wrapper.html`
- **Preload Script**: `src/preload.js`

## Core Application Files

### Main Application
- `src/main.js` - Main Electron process, window management, IPC handlers, session management integration
- `src/app-wrapper.html` - Primary application wrapper with ERP interface integration, session management UI integration
- `src/preload.js` - Secure IPC bridge between main and renderer processes, session management APIs
- `src/toolbar.html` - Application toolbar with navigation and session management controls (updated button text)

### Session Management System
- `src/session-manager.js` - Multi-user session management with PIN-based authentication, AES-256-GCM encryption, automatic session timeout, and auto-activation of new sessions
- `src/session-switcher.html` - Session management interface with modern glassmorphism design, enhanced Aeris branding, improved layout without scrollbars, and session lock functionality

### Settings & Configuration  
- `src/settings.html` - Application configuration interface with session timeout settings (5-120 minutes)

### Utility Files
- `src/error.html` - Error page template
- `src/print-example.html` - Print functionality example

## Assets

### Images & Icons
- `src/assets/images/logo.png` - Aeris company logo (used in session management interface)
- `src/assets/icons/` - Application icons for different platforms
  - `icon.png` - Standard PNG icon
  - `icon.ico` - Windows icon  
  - `icon.icns` - macOS icon

### Fonts
- `src/assets/fonts/` - Poppins font family
  - `Poppins-Regular.woff2`
  - `Poppins-Medium.woff2` 
  - `Poppins-SemiBold.woff2`
  - `poppins.css` - Font face definitions

## Configuration Files
- `package.json` - Node.js project configuration and dependencies (version 1.0.5)
- `package-lock.json` - Dependency lock file
- `.github/workflows/build-release.yml` - GitHub Actions CI/CD pipeline

## Key Features

### Session Management (v1.0.5)
- **Multi-User Support**: Up to 5 concurrent user sessions
- **PIN Authentication**: 4-digit PIN protection with AES-256-GCM encryption
- **Session Persistence**: Sessions persist during app runtime only
- **Automatic Timeout**: Configurable session timeout (5-120 minutes, default 30)
- **Session Operations**: Create, switch, lock, unlock, rename, delete
- **UI Integration**: Modern glassmorphism design with Aeris branding
- **Keyboard Shortcuts**: 
  - Ctrl+Shift+S: Open session manager
  - Ctrl+L: Lock current session
- **Auto-Activation**: New sessions automatically become active upon creation

### Application Features
- **ERP Integration**: Embedded web-based ERP system
- **Window Management**: Resizable application window with state persistence
- **Settings Management**: Persistent configuration storage
- **Update Checking**: Automatic update notification system
- **Print Support**: Integrated printing functionality
- **Modern UI**: Clean, professional interface design

### Security Features  
- **Encryption**: AES-256-GCM for PIN storage
- **Context Isolation**: Secure renderer process isolation
- **IPC Security**: Controlled inter-process communication
- **Session Security**: Automatic session locking on timeout

## Recent Updates (v1.0.5)

### UI Improvements
- **Enhanced Aeris Logo**: Larger, more prominent logo in session manager (120x120px container)
- **Improved Layout**: Fixed "No Sessions Yet" text positioning and container sizing
- **Clean Session Cards**: Removed "No URL" text from session display
- **Button Updates**: Changed "Session Switch" to "Sessions" in toolbar
- **Better Visibility**: Adjusted colors and opacity for better readability
- **Scrollbar Removal**: Fixed container dimensions to eliminate scrollbars (80vh height)

### Session Management Fixes
- **Auto-Activation**: New sessions automatically become active upon creation
- **Lock Functionality**: Fixed session locking from toolbar when active session exists
- **Status Consistency**: Improved session status tracking and display
- **Session State**: Enhanced session lifecycle management

### Color Scheme Refinements
- **Text Color**: All fonts updated to #fdf0d5 (cream/beige)
- **Button Colors**: Red buttons (#c1121f) with cream text and darker hover states
- **Background Opacity**: Increased modal opacity for better content masking (98%)
- **Gradient Updates**: New session cards use dark red gradient instead of purple

## Architecture Notes
- **Event-Driven**: Session manager uses EventEmitter pattern for state management
- **Secure Storage**: Settings stored using electron-store with encryption for sensitive data
- **Cross-Platform**: Supports Windows, macOS, and Linux
- **Modern Standards**: ES6+ JavaScript, CSS Grid/Flexbox, HTML5 semantic elements

## Dependencies

### Production Dependencies
- **electron-store**: Persistent storage for application settings

### Development Dependencies
- **electron**: Cross-platform desktop app framework
- **electron-builder**: Build and packaging tool for distribution

## Key Features Implemented

### Core Features
- Cross-platform desktop application (Windows/macOS)
- Configurable server URL with connection testing (default: http://10.0.0.140:8000)
- Auto-start functionality
- Window state persistence (size, position, maximized state)
- Graceful offline handling
- Security hardening (context isolation, restricted navigation)
- Native menu integration with keyboard shortcuts
- Settings management with persistent storage
- **Custom Navigation Toolbar**: Professional 60px toolbar with Aeris logo (60px), 50x50px navigation buttons, and integrated user information display
- **Function Key Shortcuts**: F1-F5 buttons temporarily commented out for future refinement and customization
- **Connection Status Indicator**: Visual indicator showing real-time connection status to the ERP server
- **Header Integration**: Intelligently hides only the user dropdown elements while preserving the main navigation menu for seamless user experience
- **User Information Display**: Automatically extracts username from ERP and displays with logout functionality in the custom toolbar
- **Poppins Typography**: Consistent Poppins font family applied throughout application and injected into web content
- **WebView Integration**: Uses webview instead of iframe to bypass X-Frame-Options restrictions and provide better ERP integration
- **Automatic Bootstrap Modal Focus Fix**: Transparently resolves input focus issues after JavaScript confirm/alert dialogs without requiring any ERP application changes
- **Automated Release Pipeline**: GitHub Actions workflow for cross-platform builds and releases (executable files only, no source archives)
- **🆕 GitHub Update Checking**: Automatic update notifications with direct links to releases and downloads
- **🆕 Multi-User Session Management**: Create and manage up to 5 concurrent user sessions with PIN protection
- **🆕 Session Security**: Encrypted PIN storage and automatic session locking with configurable timeout
- **🆕 Session Switcher UI**: Creative, modern interface for managing multiple sessions with intuitive design

### Update Checking Features
- **Automatic Update Detection** - Checks GitHub releases on app startup and every 6 hours
- **Visual Notification** - Orange pulsing button appears in toolbar when updates are available
- **Update Dialog** - Beautiful modal showing current vs latest version with download options
- **Direct Download Links** - Platform-specific download URLs for immediate update installation
- **Release Notes Access** - One-click access to GitHub release pages with full changelog
- **Version Comparison** - Semantic version comparison to determine if updates are available
- **Error Handling** - Graceful handling of network errors and API failures
- **Manual Check** - Users can manually check for updates via the toolbar button

### Update API Functions
Available through `window.electronAPI`:
- `checkForUpdates()` - Check GitHub releases for new versions
- `openReleasePage(url)` - Open GitHub release or download page in default browser

### Printing Features
- **Standard Print Dialog** - Opens system print dialog (Ctrl/Cmd+P)
- **Print Preview** - Generate PDF preview in new window (Ctrl/Cmd+Shift+P)
- **Silent Printing** - Print directly to default printer without dialog
- **Network Printer Support** - Enumerate and print to specific network printers
- **PDF Export** - Convert pages to PDF for download/saving
- **Custom Print Options** - Landscape, copies, margins, background printing
- **Browser Compatibility** - Graceful fallback to window.print() for web version

### Printing API Functions
Available through `window.electronAPI`:
- `printPage(options)` - Print with optional configuration
- `printSilent(options)` - Silent print to specific printer
- `printToPDF(options)` - Generate PDF version
- `getPrinters()` - Enumerate available printers

### Navigation API Functions
Available through `window.electronAPI`:
- `navigate(direction)` - Navigate back, forward, refresh, or home
- `navigateToUrl(url)` - Navigate to specific ERP section
- `openSettings()` - Open application settings window

### Session Management API Functions
Available through `window.electronAPI`:
- `getSessions()` - Get all available sessions
- `createSession(name, pin)` - Create new session with encrypted PIN
- `switchToSession(sessionId, pin)` - Switch to existing session with PIN verification
- `deleteSession(sessionId)` - Delete a session
- `renameSession(sessionId, newName)` - Rename an existing session
- `getActiveSession()` - Get currently active session
- `showSessionSwitcher()` - Display session management interface
- `updateSessionActivity()` - Update session activity to reset timeout

## Configuration Changes
- **Default Server URL**: Updated from localhost:8080 to 10.0.0.140:8000
- **Settings Interface**: Updated placeholder to reflect new default IP
- **Menu Integration**: Added Print and Print Preview to View menu
- **🆕 GitHub Repository**: Update checking requires replacing `YOUR_USERNAME/YOUR_REPO_NAME` in main.js with actual repository details
- **🆕 Session Management**: Added session timeout configuration to settings (default: 30 minutes)
- **🆕 Session Toolbar**: Added session switcher button with keyboard shortcut (Ctrl+Shift+S)

## Setup Requirements for Update Checking
1. **Update Repository URL**: Replace `YOUR_USERNAME/YOUR_REPO_NAME` in `src/main.js` line 100 with your actual GitHub repository
2. **GitHub Releases**: Ensure your repository has public releases with proper version tags (e.g., `v1.0.5`)
3. **Release Assets**: Include platform-specific installers (.dmg for macOS, .exe for Windows) as release assets

## Next Steps
- User needs to provide application icons in the specified formats
- Icons should be placed in `src/assets/icons/` directory
- **Configure GitHub repository URL** for update checking functionality
- Application will be ready to run after `npm install` and icon placement
- Print functionality is immediately available and compatible with network printers
- Update checking will work once GitHub repository is configured

## Automatic Modal Fix (No ERP Changes Required)
The Electron client automatically injects JavaScript code that:
- Replaces `window.confirm()` and `window.alert()` with Electron native dialogs
- Automatically restores focus to Bootstrap modal inputs after dialogs close
- Works transparently without requiring any changes to the ERP web application
- Maintains full compatibility - the same ERP code works in both Electron and web browsers
- Activates on every page load/navigation automatically 