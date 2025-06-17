# Aeris Client Release Process

This document explains the automated release process for the Aeris desktop client.

## Automated Build Pipeline

The project uses GitHub Actions to automatically build and release distribution packages when the `release` branch is updated.

### Workflow Overview

**File**: `.github/workflows/build-release.yml`

**Triggers**: 
- Push to `release` branch (creates release)
- Pull request to `release` branch (builds for testing)

**Build Matrix**:
- **macOS**: Builds universal DMG files for Intel and Apple Silicon
- **Windows**: Builds NSIS installer executable

### Release Process

1. **Merge to Release Branch**:
   ```bash
   git checkout release
   git merge main
   git push origin release
   ```

2. **Automatic Build Process**:
   - GitHub Actions detects the push to `release`
   - Builds on both macOS and Windows runners
   - Creates distribution packages:
     - `Aeris-1.0.0.dmg` (macOS Intel)
     - `Aeris-1.0.0-arm64.dmg` (macOS Apple Silicon)
     - `Aeris Setup 1.0.0.exe` (Windows)

3. **Automatic Release Creation**:
   - Creates a new GitHub release with tag `v{version}-{build_number}`
   - Uploads all distribution files as release assets
   - Generates release notes with features and installation instructions

### Generated Artifacts

Each successful build creates:

**macOS**:
- `*.dmg` - Disk image installers
- `*.dmg.blockmap` - Auto-updater files
- `latest-mac.yml` - Update metadata

**Windows**:
- `*.exe` - NSIS installer
- `*.exe.blockmap` - Auto-updater files  
- `latest.yml` - Update metadata

### Release Features

The automated release includes:
- ✅ Cross-platform builds (Mac Intel/ARM + Windows)
- ✅ Automatic version detection from `package.json`
- ✅ GitHub Release creation with downloadable assets
- ✅ Comprehensive release notes
- ✅ Build notifications (success/failure)

### Manual Release (if needed)

To create releases manually:

```bash
# Build locally
npm run build:mac    # On macOS
npm run build:win    # On Windows or via cross-compilation

# Assets will be in dist/ directory
```

### Version Management

- Version is automatically read from `package.json`
- Release tags follow format: `v{version}-{build_number}`
- Each push to `release` creates a new build number

### Security Notes

- No code signing certificates configured (binaries may show security warnings)
- Users may need to allow unsigned applications in system settings
- Consider adding code signing for production releases

---

## Quick Start for Releases

1. **Update version in `package.json`** (if needed)
2. **Push to release branch**:
   ```bash
   git checkout release
   git merge main
   git push origin release
   ```
3. **Check GitHub Actions** for build status
4. **Download from GitHub Releases** when complete

The entire process is automated - just push to `release` and GitHub will handle the rest! 