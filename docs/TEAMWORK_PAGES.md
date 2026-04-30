# Teamwork Spaces Documentation

## Overview

This document tracks the Aeris Desktop Client documentation pages created in the Clermont Digital Teamwork Spaces.

## Teamwork Space Information

- **Space ID**: 4632
- **Space Name**: AERIS
- **Installation**: clermontdigital
- **Base URL**: https://clermontdigital.teamwork.com/spaces

## Created Pages

### 1. Desktop Client (Windows & macOS) - Technical Documentation

**Location**: Technical Section
**Page ID**: 42255
**Parent ID**: 42186 (Technical)
**Status**: Draft (created, not yet published)
**Created**: 2025-11-13

**Content Summary**:
- Comprehensive technical documentation for developers and IT administrators
- Architecture details (Main Process, Session Manager, IPC Handlers, Preload Script)
- Security model (AES-256-GCM encryption, context isolation, PIN lockout)
- Operating modes (Single-User and Multi-User)
- Testing & Quality Assurance (92.4% coverage, 121 tests)
- **CI/CD Pipeline documentation**:
  - Branch strategy (main vs. release)
  - Test-first pipeline approach
  - Build phases (test → build → release → notify)
  - Quality gates (80% coverage minimum, 100% pass rate required)
  - Deployment workflow
- Configuration management
- Installation instructions (Windows and macOS)
- Development setup and commands
- Support and troubleshooting
- Version history

**Key Technical Highlights**:
- Test coverage: 92.4% (exceeds 80% target)
- CI/CD: Automated test-first pipeline
- Security: AES-256-GCM encryption, PIN lockout protection
- Platform: Electron (Node.js + Chromium)
- Platforms: Windows 10/11 (x64), macOS Intel/ARM64

### 2. Aeris Desktop Client - Product Documentation

**Location**: Product Section
**Page ID**: 42256
**Parent ID**: 42189 (Product)
**Status**: Draft (created, not yet published)
**Created**: 2025-11-13

**Content Summary**:
- Business-focused documentation for end users and decision makers
- Product overview and key benefits
- Target audience identification
- Platform availability (Windows and macOS)
- Core features:
  - Multi-user session management
  - Flexible operating modes
  - Professional printing support
  - Server configuration
  - Enhanced security
  - Productivity features
- Installation guides (step-by-step for both platforms)
- First-time setup instructions
- Multi-user session usage guide
- System requirements
- Common use cases (retail, service business, owner-operated, multi-location)
- Support and training resources
- Updates and maintenance information
- Frequently Asked Questions
- Pricing and licensing (included with Aeris ERP subscription)
- Contact information

**Key Product Highlights**:
- Native desktop experience for Windows and macOS
- Multi-user support (up to 5 concurrent sessions)
- Enterprise-grade security with AES-256-GCM encryption
- Professional printing (network, USB, thermal receipt printers)
- Included with Aeris ERP subscription at no additional cost
- Open-source software (MIT License)

## Documentation Structure in Teamwork

```
AERIS (42167)
├── Product (42189)
│   ├── Product Definition (42190)
│   ├── Product Flow (42191)
│   ├── User Permissions (Default) (42192)
│   └── Aeris Desktop Client (42256) ← NEW PRODUCT DOC
│
├── Technical (42186)
│   ├── Database Schema (42187)
│   ├── Development Setup (42193)
│   ├── API Documentation (42195)
│   ├── Architecture (42196)
│   ├── Testing Guide (42198)
│   ├── Security (42202)
│   ├── CI/CD Pipeline (42203)
│   └── Desktop Client (Windows & macOS) (42255) ← NEW TECHNICAL DOC
│
├── Support (42199)
├── Roadmap (42204)
├── Marketplace (42217)
└── Security (42225)
```

## CI/CD Information Included

Both documentation pages include comprehensive CI/CD information:

### Technical Documentation (42255)
- **Full CI/CD section** with detailed pipeline architecture
- Branch strategy explanation (main for development, release for deployment)
- Pipeline phases breakdown:
  1. Test Phase (Gatekeeper) - ~3 seconds on ubuntu-latest
  2. Build Phase (Platform-Specific) - ~15 minutes on macOS/Windows
  3. Release Phase - GitHub release creation
  4. Notify Phase - Status reporting
- Quality gates: 80% coverage minimum, 92.4% current achievement
- Deployment workflow with step-by-step commands
- Test coverage thresholds and enforcement

### Product Documentation (42256)
- **Updates and Maintenance section** covering:
  - Manual update process through GitHub Releases
  - Version information (v1.2.0)
  - Highlights including automated testing and build process

## Access and Publishing

### Viewing Pages

**Technical Page URL**:
https://clermontdigital.teamwork.com/spaces/#/aeris/technical/desktop-client-windows-macos

**Product Page URL**:
https://clermontdigital.teamwork.com/spaces/#/aeris/product/aeris-desktop-client

**Note**: Pages are currently in draft status. They need to be published to be visible to all team members.

### Publishing Pages

To publish the pages, use the Teamwork API or UI:

```bash
# Set environment variables
export TOKEN="your_teamwork_api_token"
export SPACE_ID="4632"
export INSTALLATION="clermontdigital"

# Publish technical page
curl -s -H "Authorization: Bearer $TOKEN" \
  -X POST "https://${INSTALLATION}.teamwork.com/spaces/api/v1/spaces/${SPACE_ID}/pages/42255/publish.json"

# Publish product page
curl -s -H "Authorization: Bearer $TOKEN" \
  -X POST "https://${INSTALLATION}.teamwork.com/spaces/api/v1/spaces/${SPACE_ID}/pages/42256/publish.json"
```

Or use the Teamwork Spaces web interface:
1. Navigate to the page
2. Click "Publish" button in the editor
3. Confirm publication

## API Credentials

API credentials are stored in `.env` file in the project root (gitignored):

```bash
TEAMWORK_API_KEY=your_token_here
TEAMWORK_DOMAIN=clermontdigital
TEAMWORK_SPACE_ID=4632
```

**Security Note**: The `.env` file is already in `.gitignore` and should never be committed to the repository.

## Maintenance

### Updating Pages

To update a page:

1. Get current page details to find draftVersion:
   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" \
     "https://${INSTALLATION}.teamwork.com/spaces/api/v1/spaces/${SPACE_ID}/pages/{PAGE_ID}.json"
   ```

2. Increment draftVersion and prepare update JSON (no parentId in updates!)

3. Apply update with PATCH (not PUT):
   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -X PATCH "https://${INSTALLATION}.teamwork.com/spaces/api/v1/spaces/${SPACE_ID}/pages/{PAGE_ID}.json" \
     -d @update.json
   ```

4. Publish if needed

### Syncing with Repository Changes

When the Aeris Desktop Client codebase is updated:

1. **Version Updates**: Update version numbers in both pages
2. **Feature Additions**: Add new features to appropriate sections
3. **CI/CD Changes**: Update pipeline documentation if workflow changes
4. **Test Coverage**: Update test statistics when coverage changes

### Important Gotchas

See `docs/teamwork.md` for complete API guide. Key points:

- **Use PATCH for updates**, not PUT (PUT returns 404)
- **Never include parentId in update payloads** (causes type mismatch error)
- **Always increment draftVersion** for updates
- **Start content with `<h2>`**, not `<h1>` (Teamwork uses page title as H1)
- **Escape newlines as `\n`** in JSON content
- **Pages are created as drafts** - publish separately

## Content Formatting

Both pages use HTML formatting following Teamwork Spaces guidelines:

- **Headings**: `<h2>`, `<h3>`, `<h4>` (never `<h1>`)
- **Paragraphs**: `<div>` tags
- **Lists**: `<ul>`/`<ol>` with `<li>` items
- **Bold**: `<strong>` tags
- **Emphasis**: `<em>` tags
- **Code**: `<code>` tags
- **Links**: `<a href="">` tags
- **Tables**: `<table>` with `<thead>` and `<tbody>`

## Related Documentation

- **Teamwork API Guide**: `docs/teamwork.md`
- **CI/CD Documentation**: `docs/CICD.md`
- **Development Guide**: `docs/CLAUDE.md`
- **Testing Guide**: `docs/TESTING_AUTOMATED.md`
- **TDD Review**: `docs/TDD_REVIEW.md`

## Summary

Successfully created comprehensive documentation for the Aeris Desktop Client in Teamwork Spaces:

✅ **Technical Documentation** (42255)
- Target: Developers, IT administrators, DevOps engineers
- Focus: Architecture, security, testing, CI/CD pipeline
- Depth: Full technical specifications and implementation details

✅ **Product Documentation** (42256)
- Target: Business users, end users, decision makers
- Focus: Features, benefits, use cases, installation
- Depth: User-friendly explanations and practical guidance

Both pages include information about the CI/CD pipeline and are ready for team review and publication.
