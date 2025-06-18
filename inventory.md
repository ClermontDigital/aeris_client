# Aeris Client - File Inventory

## Project Structure

```
aeris_client/
├── package.json                 # Node.js dependencies and build configuration
├── README.md                   # Project documentation and setup instructions
├── RELEASE.md                  # Release process and GitHub Actions documentation
├── inventory.md                # This file - tracks all project files
├── .github/
│   └── workflows/
│       └── build-release.yml   # GitHub Actions automated build pipeline
└── src/
    ├── main.js                 # Main Electron process - window management and app lifecycle
    ├── preload.js              # Secure IPC communication bridge with session and printing APIs
    ├── session-manager.js      # Session management with encrypted PIN protection and timeouts
    ├── app-wrapper.html        # Main application wrapper containing toolbar and ERP content
    ├── toolbar.html            # Custom navigation toolbar with session switcher button
    ├── session-switcher.html   # Creative session management UI with modern design
    ├── error.html              # Error page displayed when server is unavailable
    ├── settings.html           # Settings configuration page with session timeout option
    ├── print-example.html      # Demo page showing print functionality usage
    └── assets/
        ├── fonts/              # Typography assets
        │   ├── poppins.css     # Poppins font definitions
        │   ├── Poppins-Regular.woff2    # Regular weight font
        │   ├── Poppins-Medium.woff2     # Medium weight font
        │   └── Poppins-SemiBold.woff2   # SemiBold weight font
        ├── icons/              # Application icons (to be provided)
        │   ├── icon.png        # 512x512px main icon (required)
        │   ├── icon.ico        # Windows format icon (required)
        │   └── icon.icns       # macOS format icon (required)
        └── images/             # Additional branding images
            └── logo.png        # Aeris logo used in toolbar
```

## File Descriptions

### Core Application Files
- **package.json**: Defines project metadata, dependencies (Electron, electron-store, electron-builder), and build scripts for cross-platform distribution
- **src/main.js**: Main Electron process handling window creation, menu setup, settings management, IPC communication, comprehensive printing functionality, GitHub release checking, and multi-user session management
- **src/preload.js**: Security layer providing safe IPC communication between main and renderer processes, includes printing API exposure, update checking functions, and session management APIs
- **src/session-manager.js**: Comprehensive session management system with encrypted PIN storage, automatic timeouts, and event-driven architecture

### User Interface Files
- **src/app-wrapper.html**: Main application container that displays the custom toolbar above the ERP web application in an iframe layout, includes update dialog functionality and session switching handlers
- **src/toolbar.html**: Custom navigation toolbar (60px height) with 50x50px buttons for back, forward, refresh, home, print, session management, settings, and update notifications
- **src/session-switcher.html**: Modern, creative session management interface with glassmorphism design, PIN input modal, and intuitive session cards
- **src/error.html**: Elegant error page with retry functionality, displayed when Aeris ERP server is unavailable
- **src/settings.html**: Configuration interface for server URL (default: 10.0.0.140:8000), auto-start preferences, and session timeout settings with connection testing
- **src/print-example.html**: Demonstration page showing how to use all printing functions from within the web application

### Assets (To Be Added)
- **src/assets/icons/**: Directory for application icons in multiple formats (PNG, ICO, ICNS)
- **src/assets/images/**: Directory for additional branding assets

### Documentation
- **README.md**: Comprehensive documentation including setup, development, and build instructions
- **RELEASE.md**: Release process documentation and GitHub Actions workflow guide
- **inventory.md**: This file - maintains complete project file inventory

### Build & Release
- **.github/workflows/build-release.yml**: Automated GitHub Actions pipeline for cross-platform builds and releases (excludes source code archives)

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