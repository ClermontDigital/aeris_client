# Changelog

All notable changes to the Aeris ERP Client will be documented in this file.

## [1.2.0] - 2025-10-31

### Added - Major Testing Implementation
- **Automated Test Suite**: Comprehensive Jest-based testing with 121 tests
  - 48 tests for SessionManager (98.1% coverage)
  - 60 tests for IPC Handlers (86.59% coverage)
  - 13 tests for Preload (95.65% coverage)
- **Test Infrastructure**:
  - Jest testing framework with full configuration
  - Comprehensive Electron mocks
  - electron-store mock implementation
  - Coverage thresholds enforced (80%+ global)
- **Test Scripts**: `npm test`, `npm run test:coverage`, `npm run test:watch`
- **Code Refactoring**:
  - Extracted `src/ipc-handlers.js` from main.js for testability
  - Implemented dependency injection patterns
  - Improved code architecture for testing
- **Documentation**:
  - New: `docs/TESTING_AUTOMATED.md` - Complete automated testing guide
  - New: `TESTING_SUMMARY.md` - Executive summary of testing implementation
  - Updated: `docs/TDD_REVIEW.md` - Shows before/after results
  - Updated: `README.md` - Includes testing section

### Test Coverage
- **Overall**: 92.4% code coverage (exceeds 80% target by 12.4%)
- **Pass Rate**: 100% (121/121 tests passing, exceeds 90% target by 10%)
- **Modules**:
  - session-manager.js: 98.1% coverage
  - ipc-handlers.js: 86.59% coverage
  - preload.js: 95.65% coverage

### Security Tests Added
- AES-256-GCM PIN encryption validation
- PIN lockout mechanism (3 attempts, 5-minute timeout)
- URL validation for external links
- Session timeout enforcement (5-120 minutes)
- Maximum session limits (5 sessions)

### Technical Improvements
- Testable architecture with dependency injection
- Mock infrastructure for Electron testing
- CI/CD ready test configuration
- Regression protection for all critical paths
- Comprehensive error handling validation

### Developer Experience
- Instant feedback via automated tests
- TDD workflow enabled
- Watch mode for continuous testing
- Coverage reports with detailed metrics

## [1.1.3] - 2025-06-20

### Features
- Multi-user session management with PIN protection
- Session auto-lock timeout (5-120 minutes configurable)
- AES-256-GCM encryption for PIN storage
- Dual operating modes (single-user/multi-user)
- Cross-platform support (Windows/macOS Intel/ARM64)

### Security
- Context isolation enabled
- Node integration disabled in renderer
- PIN attempt limiting (3 attempts, 5-minute lockout)
- Secure URL validation
- External link protection

### Previous Versions
See git history for versions 1.1.2 and earlier.

---

## Version Numbering

This project uses [Semantic Versioning](https://semver.org/):
- **MAJOR** version for incompatible API changes
- **MINOR** version for new functionality in a backwards compatible manner
- **PATCH** version for backwards compatible bug fixes

## Links
- [Repository](https://github.com/yourusername/aeris_client)
- [Issues](https://github.com/yourusername/aeris_client/issues)
- [Releases](https://github.com/yourusername/aeris_client/releases)
