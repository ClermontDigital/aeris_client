# Aeris Client - File Inventory

## Project Structure

```
aeris_client/
├── package.json                 # Node.js dependencies and build configuration
├── README.md                   # Project documentation and setup instructions
├── inventory.md                # This file - tracks all project files
└── src/
    ├── main.js                 # Main Electron process - window management and app lifecycle
    ├── preload.js              # Secure IPC communication bridge
    ├── error.html              # Error page displayed when server is unavailable
    ├── settings.html           # Settings configuration page
    └── assets/
        ├── icons/              # Application icons (to be provided)
        │   ├── icon.png        # 512x512px main icon (required)
        │   ├── icon.ico        # Windows format icon (required)
        │   └── icon.icns       # macOS format icon (required)
        └── images/             # Additional branding images
            └── logo.png        # Optional logo for in-app branding
```

## File Descriptions

### Core Application Files
- **package.json**: Defines project metadata, dependencies (Electron, electron-store, electron-builder), and build scripts for cross-platform distribution
- **src/main.js**: Main Electron process handling window creation, menu setup, settings management, and IPC communication
- **src/preload.js**: Security layer providing safe IPC communication between main and renderer processes

### User Interface Files
- **src/error.html**: Elegant error page with retry functionality, displayed when Aeris ERP server is unavailable
- **src/settings.html**: Configuration interface for server URL and auto-start preferences with connection testing

### Assets (To Be Added)
- **src/assets/icons/**: Directory for application icons in multiple formats (PNG, ICO, ICNS)
- **src/assets/images/**: Directory for additional branding assets

### Documentation
- **README.md**: Comprehensive documentation including setup, development, and build instructions
- **inventory.md**: This file - maintains complete project file inventory

## Dependencies

### Production Dependencies
- **electron-store**: Persistent storage for application settings

### Development Dependencies
- **electron**: Cross-platform desktop app framework
- **electron-builder**: Build and packaging tool for distribution

## Key Features Implemented
- Cross-platform desktop application (Windows/macOS)
- Configurable server URL with connection testing
- Auto-start functionality
- Window state persistence (size, position, maximized state)
- Graceful offline handling
- Security hardening (context isolation, restricted navigation)
- Native menu integration with keyboard shortcuts
- Settings management with persistent storage

## Next Steps
- User needs to provide application icons in the specified formats
- Icons should be placed in `src/assets/icons/` directory
- Application will be ready to run after `npm install` and icon placement 