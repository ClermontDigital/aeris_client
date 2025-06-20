# Aeris Client - Source File Inventory

## Version: 1.0.6
## Last Updated: December 2024

## Project Structure
- **Type**: Electron Desktop Application  
- **Main Process**: `src/main.js`
- **Renderer Process**: `src/app-wrapper.html`
- **Preload Script**: `src/preload.js`

## Core Application Files

### Main Application
- `src/main.js` - Main Electron process, window management, IPC handlers
- `src/app-wrapper.html` - Primary application wrapper with ERP interface integration
- `src/preload.js` - Secure IPC bridge between main and renderer processes
- `src/toolbar.html` - Simplified application toolbar with just title display

### Session Management
- `src/session-manager.js` - Multi-user session management with encrypted PIN storage
- `src/session-switcher.html` - Session management interface (fallback/placeholder)

### Settings & Configuration  
- `src/settings.html` - Application configuration interface with session management toggle

### Utility Files
- `src/error.html` - Error page template
- `src/print-example.html` - Print functionality example

### Testing & Documentation
- `TESTING.md` - Comprehensive test suite with 15 test categories
- `RELEASE.md` - Release process documentation

## Assets

### Images & Icons
- `src/assets/images/logo.png` - Aeris company logo
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
- `package.json` - Node.js project configuration and dependencies (version 1.0.6)
- `package-lock.json` - Dependency lock file
- `.github/workflows/build-release.yml` - GitHub Actions CI/CD pipeline

## Key Features

### Application Features
- **ERP Integration**: Embedded web-based ERP system
- **Window Management**: Resizable application window with state persistence
- **Settings Management**: Persistent configuration storage
- **Print Support**: Integrated printing functionality
- **Clean UI**: Simplified, professional interface design

### Security Features  
- **Context Isolation**: Secure renderer process isolation
- **IPC Security**: Controlled inter-process communication

## Recent Updates (v1.0.6)

### Session Management Toggle System
- **Configurable Session Management**: Added ability to enable/disable multi-user session management
- **Single-User Mode**: When disabled, application launches directly to ERP with simplified interface
- **Multi-User Mode**: When enabled, provides full session management with PIN-protected user switching
- **Settings Integration**: New toggle in settings to control session management functionality

### Session Management Features (When Enabled)
- **Encrypted PIN Storage**: Secure AES-256-GCM encryption for user PINs
- **Session Isolation**: Each user gets isolated browser session with separate cookies/storage
- **Auto-Lock Timeout**: Configurable session timeout (5-120 minutes, default 30 minutes)
- **Maximum 5 Sessions**: Limit to prevent resource overuse
- **Session Persistence**: Sessions persist during app runtime but reset on restart
- **Visual Lock Screen**: Clean overlay when sessions are locked

### UI Enhancements
- **Dynamic Button Visibility**: Session management buttons automatically hide in single-user mode
- **Enhanced PIN Input**: Improved PIN entry with auto-advance and validation
- **Settings Synchronization**: Real-time settings updates across all windows
- **Better Error Handling**: Improved unlock functionality and error feedback
- **Clean Debug Output**: Removed excessive console logging while maintaining essential debugging

### Quality Assurance
- **Comprehensive Test Suite**: 15 test categories covering all functionality
- **Regression Testing**: Specific tests for session button visibility and settings updates
- **Automated Testing Ready**: Documentation for future CI/CD integration
- **Edge Case Coverage**: Error handling and data validation tests

### Previous Updates (v1.0.5)
- UI Simplification and session management system implementation
- Streamlined interface with focus on core ERP functionality

## Architecture Notes
- **Secure Storage**: Settings stored using electron-store
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
- **Clean Navigation Toolbar**: Simple 60px toolbar with Aeris ERP title
- **Connection Status Indicator**: Visual indicator showing real-time connection status to the ERP server
- **User Information Display**: Automatically extracts username from ERP and displays with logout functionality
- **Poppins Typography**: Consistent Poppins font family applied throughout application and injected into web content
- **WebView Integration**: Uses webview instead of iframe to bypass X-Frame-Options restrictions and provide better ERP integration
- **Automatic Bootstrap Modal Focus Fix**: Transparently resolves input focus issues after JavaScript confirm/alert dialogs without requiring any ERP application changes
- **Automated Release Pipeline**: GitHub Actions workflow for cross-platform builds and releases (executable files only, no source archives)

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

## Configuration Changes
- **Default Server URL**: Updated from localhost:8080 to 10.0.0.140:8000
- **Settings Interface**: Updated placeholder to reflect new default IP
- **Menu Integration**: Added Print and Print Preview to View menu

## Next Steps
- User needs to provide application icons in the specified formats
- Icons should be placed in `src/assets/icons/` directory
- Application will be ready to run after `npm install` and icon placement
- Print functionality is immediately available and compatible with network printers

## Automatic Modal Fix (No ERP Changes Required)
The Electron client automatically injects JavaScript code that:
- Replaces `window.confirm()` and `window.alert()` with Electron native dialogs
- Automatically restores focus to Bootstrap modal inputs after dialogs close
- Works transparently without requiring any changes to the ERP web application
- Maintains full compatibility - the same ERP code works in both Electron and web browsers
- Activates on every page load/navigation automatically 

### Core Application Files

#### `src/main.js` (Primary Electron Main Process)
- **Purpose**: Main Electron process, window management, IPC handlers
- **Key Functions**: 
  - Window creation and management
  - Settings storage and retrieval
  - Session management IPC handlers
  - Print functionality
  - Update checking
  - App lifecycle management
- **Recent Changes**: 
  - Enhanced error handling for session operations
  - Added proper cleanup on app close
  - Improved session management error messages
  - Fixed settings update logic for immediate vs restart-required changes

#### `src/preload.js` (Electron Preload Script)
- **Purpose**: Secure bridge between main process and renderer
- **Key Functions**: 
  - Exposes electronAPI to renderer processes
  - Settings management APIs
  - Session management APIs
  - Print APIs
  - Event listeners for settings updates
- **Recent Changes**: No changes in this review

#### `src/app-wrapper.html` (Main Application Container)
- **Purpose**: Primary application interface, session management UI
- **Key Functions**: 
  - Application initialization
  - Session switching interface
  - PIN-based authentication
  - Settings synchronization across frames
  - Error handling and connection management
- **Recent Changes**: 
  - **CRITICAL FIX**: Optimized settings loading to prevent multiple API calls
  - Consolidated settings loading logic to reduce debug spam
  - Improved toolbar settings synchronization
  - Removed redundant `loadSettings()` function

#### `src/session-manager.js` (Session Management Backend)
- **Purpose**: Core session management logic with encryption
- **Key Functions**: 
  - Session creation, deletion, switching
  - PIN encryption/decryption using AES-256-GCM
  - Session timeout management
  - Activity tracking
- **Recent Changes**: 
  - **SECURITY ENHANCEMENT**: Added PIN attempt limiting (3 attempts, 5-minute lockout)
  - **VALIDATION**: Added session timeout range validation (5-120 minutes)
  - **STABILITY**: Improved cleanup method to prevent memory leaks
  - Added PIN attempt tracking and lockout functionality

#### `src/toolbar.html` (Application Toolbar)
- **Purpose**: Navigation toolbar with session management controls
- **Key Functions**: 
  - Navigation controls (back, forward, refresh, home)
  - Session management buttons (when enabled)
  - Settings access
  - Update notifications
- **Recent Changes**: No changes in this review

#### `src/settings.html` (Settings Configuration Interface)
- **Purpose**: User settings configuration
- **Key Functions**: 
  - Server URL configuration with connection testing
  - Session management toggle
  - Session timeout configuration
  - Auto-start settings
- **Recent Changes**: No changes in this review

#### `src/session-switcher.html` (Session Management Interface)
- **Purpose**: Session switching and management UI
- **Key Functions**: 
  - Session creation with PIN setup
  - Session switching with PIN authentication
  - Session deletion and management
- **Recent Changes**: No changes in this review (fallback file)

### Static Assets

#### `src/assets/fonts/` (Typography)
- `poppins.css` - Font definitions
- `Poppins-Regular.woff2`, `Poppins-Medium.woff2`, `Poppins-SemiBold.woff2` - Font files

#### `src/assets/icons/` (Application Icons)
- `icon.png`, `icon.ico`, `icon.icns` - Multi-platform app icons

#### `src/assets/images/` (Visual Assets)
- `logo.png` - Aeris logo for branding

### Configuration Files

#### `package.json` (Node.js Configuration)
- **Version**: 1.0.6
- **Dependencies**: Electron, electron-store for settings persistence
- **Scripts**: Start command for development

#### `package-lock.json` (Dependency Lock File)
- Ensures consistent dependency versions across installations

### Documentation

#### `README.md` (Project Documentation)
- Installation and usage instructions
- Feature overview
- Development setup

#### `RELEASE.md` (Release Notes)
- Version history and changelog
- Feature additions and bug fixes

#### `TESTING.md` (Test Documentation)
- Comprehensive test scenarios
- Quality assurance procedures
- Manual testing guidelines

### Code Quality Improvements Made:

1. **Performance**: Reduced multiple settings API calls from 3 to 1 on startup
2. **Security**: Added PIN attempt limiting with lockout protection
3. **Stability**: Added proper cleanup on app close to prevent memory leaks
4. **Validation**: Added input validation for session timeout ranges
5. **Error Handling**: Enhanced error messages and logging for better debugging
6. **Memory Management**: Improved timer and event listener cleanup

### Architecture Notes:

- **Single-User Mode**: When session management is disabled, app launches directly to ERP
- **Multi-User Mode**: Full session management with PIN protection and timeouts
- **Settings Synchronization**: Real-time updates across all windows and frames
- **Security**: AES-256-GCM encryption for PIN storage, attempt limiting, session isolation
- **Persistence**: Sessions exist only during runtime, settings persist between sessions

### Known Issues Resolved:

1. ✅ **Fixed**: Triple "Returning settings" debug output 
2. ✅ **Fixed**: Multiple settings loading calls causing performance issues
3. ✅ **Fixed**: Potential memory leaks from uncleaned timers and event listeners
4. ✅ **Enhanced**: Security with PIN attempt limiting
5. ✅ **Enhanced**: Input validation for configuration values 