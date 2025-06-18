# Aeris Client - Source File Inventory

## Project Structure
- **Type**: Electron Desktop Application  
- **Version**: 1.0.5
- **Main Process**: `src/main.js`
- **Renderer Process**: `src/app-wrapper.html`
- **Preload Script**: `src/preload.js`

## Core Application Files

### Main Application
- `src/main.js` - Main Electron process, window management, IPC handlers
- `src/app-wrapper.html` - Primary application wrapper with ERP interface integration
- `src/preload.js` - Secure IPC bridge between main and renderer processes
- `src/toolbar.html` - Simplified application toolbar with just title display

### Settings & Configuration  
- `src/settings.html` - Application configuration interface

### Utility Files
- `src/error.html` - Error page template
- `src/print-example.html` - Print functionality example

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
- `package.json` - Node.js project configuration and dependencies (version 1.0.5)
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

## Recent Updates (v1.0.5)

### UI Simplification
- **Removed Session Management**: Eliminated multi-user session functionality
- **Simplified Toolbar**: Clean toolbar with just "Aeris ERP" title
- **Removed Update Checking**: Eliminated automatic update notifications
- **Streamlined Interface**: Focus on core ERP functionality

### Code Cleanup
- **Removed Session Manager**: Deleted session management system
- **Simplified Main Process**: Cleaned up main.js from session-related code
- **Clean App Wrapper**: Removed session overlays and management UI
- **Simplified Toolbar**: Removed session and update buttons

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