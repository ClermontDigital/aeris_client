# CI/CD Pipeline Documentation

## Overview

The Aeris Client uses GitHub Actions for automated testing, building, and release management. The pipeline follows a test-first approach where all tests must pass before builds are executed.

## Pipeline Architecture

The CI/CD workflow is defined in `.github/workflows/build-release.yml` and consists of three sequential jobs:

### 1. Test Job (Gatekeeper)
**Purpose**: Validate code quality and correctness before building

**Runs on**: `ubuntu-latest`

**Steps**:
1. **Checkout code** - Gets the latest code from the repository
2. **Setup Node.js** - Installs Node.js 18 with npm cache
3. **Install dependencies** - Runs `npm ci` for clean install
4. **Run tests** - Executes `npm test` (all 121 tests)
5. **Run coverage** - Executes `npm run test:coverage` with detailed metrics
6. **Upload coverage** - Stores coverage reports as artifacts (7-day retention)

**Exit Behavior**: If any test fails, the entire pipeline stops and the build job never runs.

### 2. Build Job (Platform-Specific)
**Purpose**: Create distributable packages for macOS and Windows

**Depends on**: `test` job (only runs if tests pass)

**Runs on**: Matrix strategy with `macos-latest` and `windows-latest`

**Steps**:
1. **Checkout code** - Gets the latest code
2. **Setup Node.js** - Installs Node.js 18 with npm cache
3. **Install dependencies** - Runs `npm ci`
4. **Build for macOS** (if matrix.os == 'macos-latest'):
   - Runs `npm run build:mac`
   - Creates DMG files for Intel (x64) and Apple Silicon (arm64)
   - Supports notarization with Apple Developer credentials
5. **Build for Windows** (if matrix.os == 'windows-latest'):
   - Runs `npm run build:win`
   - Creates NSIS installer (.exe)
6. **Upload artifacts** - Stores build artifacts for release job

**Environment Variables**:
- `APPLE_ID` - Apple Developer account email (secret)
- `APPLE_ID_PASS` - App-specific password (secret)
- `APPLE_TEAM_ID` - Apple Developer Team ID (secret)

### 3. Release Job (GitHub Release Creation)
**Purpose**: Create GitHub release with built artifacts

**Depends on**: `build` job

**Runs on**: `ubuntu-latest`

**Conditions**: Only runs on `release` branch pushes (not pull requests)

**Steps**:
1. **Checkout code** - Gets the latest code
2. **Get version** - Extracts version from package.json
3. **Download macOS artifacts** - Gets DMG files from build job
4. **Download Windows artifacts** - Gets EXE file from build job
5. **Create release** - Creates GitHub release with:
   - Tag name: `v{version}` (e.g., v1.2.0)
   - Release notes (auto-generated from template)
   - All platform artifacts attached
6. **Remove source archives** - Cleans up auto-generated ZIP/TAR.GZ files

### 4. Notify Job (Status Notification)
**Purpose**: Report pipeline success or failure

**Depends on**: `build` and `release` jobs

**Always runs**: Even if previous jobs fail

**Outputs**:
- ✅ Success message if all jobs pass
- ❌ Failure message with exit code 1 if any job fails

## Trigger Conditions

The pipeline triggers on:

### Push Events
```yaml
on:
  push:
    branches: [ release ]
```
- Runs full pipeline (test → build → release → notify)
- Creates GitHub release
- Uploads artifacts

### Pull Request Events
```yaml
on:
  pull_request:
    branches: [ release ]
```
- Runs test and build jobs only
- No release creation
- Validates PR before merge

## Test-First Approach

### Why Test Before Build?

1. **Fast Feedback**: Tests run in ~3 seconds, much faster than builds
2. **Resource Efficiency**: Avoid wasting build time on failing code
3. **Quality Gate**: Ensures only tested code reaches production
4. **Cost Savings**: Prevents unnecessary macOS and Windows runner usage
5. **Developer Confidence**: Every release is verified by 121 tests

### Test Coverage Requirements

The pipeline enforces minimum coverage thresholds via `jest.config.js`:

```javascript
coverageThreshold: {
  global: {
    branches: 80,
    functions: 85,
    lines: 85,
    statements: 85
  }
}
```

**Current Achievement**: 92.4% overall coverage (exceeds target by 12.4%)

### What Gets Tested?

- **Session Management** (48 tests):
  - PIN encryption and validation
  - Session creation, deletion, locking
  - Timeout mechanisms
  - Security controls

- **IPC Handlers** (60 tests):
  - Settings management
  - Print functionality
  - Navigation controls
  - Dialog replacements
  - Update mechanisms

- **Preload Script** (13 tests):
  - API exposure
  - IPC channel validation
  - Event listener registration

## Artifacts and Outputs

### Coverage Reports
- **Path**: `coverage/` directory
- **Retention**: 7 days
- **Format**: HTML, JSON, LCOV
- **Access**: Download from GitHub Actions artifacts

### Build Artifacts
- **macOS**:
  - `Aeris-{version}-x64.dmg` (Intel)
  - `Aeris-{version}-arm64.dmg` (Apple Silicon)
- **Windows**:
  - `Aeris Setup {version}.exe`
- **Retention**: 30 days
- **Access**: GitHub release attachments

## Secrets Configuration

Required secrets in GitHub repository settings:

| Secret | Purpose | Example |
|--------|---------|---------|
| `APPLE_ID` | Apple Developer account | developer@company.com |
| `APPLE_ID_PASS` | App-specific password | xxxx-xxxx-xxxx-xxxx |
| `APPLE_TEAM_ID` | Apple Team ID | ABC123DEF4 |
| `GITHUB_TOKEN` | Release creation | (auto-provided) |

## Workflow Diagram

```
┌─────────────────┐
│  Push/PR to     │
│  release branch │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   TEST JOB      │
│  (ubuntu-latest)│
│                 │
│  1. npm ci      │
│  2. npm test    │ ◄── GATEKEEPER
│  3. coverage    │     (Pipeline stops here if tests fail)
│  4. upload      │
└────────┬────────┘
         │
         ▼ (only if tests pass)
┌─────────────────────────────┐
│      BUILD JOB              │
│      (matrix)               │
│                             │
│  ┌───────────────────────┐  │
│  │ macOS (Intel + ARM64) │  │
│  │  - npm run build:mac  │  │
│  │  - notarize           │  │
│  │  - upload DMGs        │  │
│  └───────────────────────┘  │
│                             │
│  ┌───────────────────────┐  │
│  │ Windows (x64)         │  │
│  │  - npm run build:win  │  │
│  │  - upload EXE         │  │
│  └───────────────────────┘  │
└────────┬────────────────────┘
         │
         ▼ (only on push to release)
┌─────────────────┐
│  RELEASE JOB    │
│  (ubuntu-latest)│
│                 │
│  1. Download    │
│     artifacts   │
│  2. Create      │
│     release     │
│  3. Upload      │
│     files       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  NOTIFY JOB     │
│  (always runs)  │
│                 │
│  - Report       │
│    status       │
└─────────────────┘
```

## Best Practices

### For Developers

1. **Run tests locally** before pushing:
   ```bash
   npm test
   npm run test:coverage
   ```

2. **Ensure coverage meets thresholds** (80%+ globally):
   - Write tests for new code
   - Update tests when modifying existing code

3. **Use semantic versioning** in package.json:
   - MAJOR: Breaking changes
   - MINOR: New features (backwards compatible)
   - PATCH: Bug fixes

4. **Test on release branch** before merging to main:
   - Create PR to release branch
   - Wait for CI/CD to pass
   - Merge if all checks pass

### For Releases

1. **Update version** in package.json
2. **Update CHANGELOG.md** with release notes
3. **Push to release branch**:
   ```bash
   git checkout release
   git add package.json CHANGELOG.md
   git commit -m "Bump version to X.Y.Z"
   git push origin release
   ```
4. **Monitor pipeline** in GitHub Actions
5. **Verify release** artifacts are correct
6. **Merge to main** after successful release

## Troubleshooting

### Tests Fail in CI but Pass Locally

**Possible causes**:
- Environment differences
- Timing issues with fake timers
- Missing dependencies

**Solutions**:
```bash
# Use exact CI commands
npm ci  # instead of npm install
npm test

# Check Node version matches CI (18)
node --version
```

### macOS Build Fails with Notarization Error

**Possible causes**:
- Invalid Apple credentials
- Expired app-specific password
- Team ID mismatch

**Solutions**:
1. Verify secrets in GitHub settings
2. Generate new app-specific password
3. Check Team ID matches Apple Developer account

### Windows Build Fails

**Possible causes**:
- Icon file issues
- NSIS configuration errors

**Solutions**:
1. Verify `src/assets/icons/icon.ico` exists
2. Check electron-builder configuration
3. Review build logs for specific errors

### Release Not Created

**Possible causes**:
- Not on release branch
- PR instead of push
- Build artifacts missing

**Solutions**:
1. Ensure pushing to `release` branch (not PR)
2. Verify build job completed successfully
3. Check artifact upload logs

## Performance Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Test execution time | < 10s | ~3s |
| Test pass rate | 90% | 100% |
| Code coverage | 80% | 92.4% |
| macOS build time | < 10min | ~8min |
| Windows build time | < 10min | ~6min |
| Total pipeline time | < 25min | ~20min |

## Future Enhancements

Potential improvements for the CI/CD pipeline:

1. **Parallel Testing**: Run test suites in parallel
2. **E2E Tests**: Add Playwright/Spectron integration tests
3. **Security Scanning**: Add dependency vulnerability scanning
4. **Performance Testing**: Monitor build artifact sizes
5. **Automated Deployment**: Deploy to distribution channels
6. **Nightly Builds**: Schedule automated builds from main
7. **Test Flake Detection**: Track intermittent failures
8. **Coverage Trending**: Track coverage over time

## References

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [electron-builder Documentation](https://www.electron.build/)
- [Jest Documentation](https://jestjs.io/)
- [Semantic Versioning](https://semver.org/)
- [Apple Notarization Guide](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
