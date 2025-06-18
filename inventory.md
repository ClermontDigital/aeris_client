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
    ├── preload.js              # Secure IPC communication bridge with printing APIs
    ├── app-wrapper.html        # Main application wrapper containing toolbar and ERP content
    ├── toolbar.html            # Custom navigation toolbar with 50x50px buttons and shortcuts
    ├── error.html              # Error page displayed when server is unavailable
    ├── settings.html           # Settings configuration page
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
- **src/main.js**: Main Electron process handling window creation, menu setup, settings management, IPC communication, and comprehensive printing functionality
- **src/preload.js**: Security layer providing safe IPC communication between main and renderer processes, includes printing API exposure

### User Interface Files
- **src/app-wrapper.html**: Main application container that displays the custom toolbar above the ERP web application in an iframe layout
- **src/toolbar.html**: Custom navigation toolbar (60px height) with 50x50px buttons for back, forward, refresh, home, F1-F5 shortcuts, print, and settings
- **src/error.html**: Elegant error page with retry functionality, displayed when Aeris ERP server is unavailable
- **src/settings.html**: Configuration interface for server URL (default: 10.0.0.140:8000) and auto-start preferences with connection testing
- **src/print-example.html**: Demonstration page showing how to use all printing functions from within the web application

### Assets (To Be Added)
- **src/assets/icons/**: Directory for application icons in multiple formats (PNG, ICO, ICNS)
- **src/assets/images/**: Directory for additional branding assets

### Documentation
- **README.md**: Comprehensive documentation including setup, development, and build instructions
- **RELEASE.md**: Release process documentation and GitHub Actions workflow guide
- **inventory.md**: This file - maintains complete project file inventory

### Build & Release
- **.github/workflows/build-release.yml**: Automated GitHub Actions pipeline for cross-platform builds and releases

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
- **Automated Release Pipeline**: GitHub Actions workflow for cross-platform builds and releases

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