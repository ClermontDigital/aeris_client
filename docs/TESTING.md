# Aeris Client v1.0.6 - Comprehensive Test Suite

## Core Application Tests

### Test 1: Application Startup & Initialization
**Purpose**: Verify application starts correctly in both modes

#### Single-User Mode Test
1. **Setup**: Ensure `enableSessionManagement: false` in settings
2. **Start Application**: `npm start`
3. **Expected Results**:
   - ✅ Application launches directly to ERP interface
   - ✅ No session management overlay appears
   - ✅ Session button (🔒) is hidden in toolbar
   - ✅ Only navigation, print, and settings buttons visible

#### Multi-User Mode Test
1. **Setup**: Ensure `enableSessionManagement: true` in settings
2. **Start Application**: `npm start`
3. **Expected Results**:
   - ✅ Session management interface appears first
   - ✅ Session button (🔒) is visible in toolbar
   - ✅ Can create new sessions or select existing ones

### Test 2: Settings Management & UI Updates

#### Session Management Toggle (Immediate Effect)
1. **Open Settings** (⚙ button or Ctrl+,)
2. **Verify Current State**:
   - ✅ Checkbox reflects current session management state
   - ✅ Session timeout field visibility matches checkbox state
3. **Toggle Session Management**:
   - ✅ Uncheck → Session timeout field disappears immediately
   - ✅ Check → Session timeout field appears immediately
4. **Save Settings**:
   - ✅ Session button visibility updates immediately in toolbar
   - ✅ No restart prompt appears
   - ✅ Settings window closes automatically

#### Server URL Change (Restart Required)
1. **Change Server URL**: Modify baseUrl field
2. **Save Settings**:
   - ✅ Shows: "Settings saved! Application will restart to apply changes."
   - ✅ Prompts: "Settings require an application restart to take effect. Restart now?"
3. **Choose Restart**: Click "OK"
   - ✅ Application restarts automatically
   - ✅ New URL is active after restart
4. **Choose Defer**: Click "Cancel"
   - ✅ Settings window closes
   - ✅ Application continues with old URL until manual restart

#### Session Timeout Change (Immediate Effect)
1. **Prerequisites**: Session management must be enabled
2. **Change Timeout**: Modify value (5-120 minutes)
3. **Save Settings**:
   - ✅ Shows: "Settings saved successfully!"
   - ✅ No restart prompt
   - ✅ New timeout applies immediately to active sessions

#### Auto-Start Toggle (Immediate Effect)
1. **Toggle Auto-Start**: Check/uncheck option
2. **Save Settings**:
   - ✅ System login item updated immediately
   - ✅ No restart required

## Session Management Tests (Multi-User Mode)

### Test 3: Session Creation & Management
1. **Create New Session**:
   - ✅ Enter unique name (max 50 characters)
   - ✅ Enter 4-digit PIN
   - ✅ Session created successfully
   - ✅ Browser resets with isolated partition
2. **Session Limits**:
   - ✅ Maximum 5 sessions enforced
   - ✅ Duplicate names rejected
3. **Session Switching**:
   - ✅ PIN required for locked sessions
   - ✅ Incorrect PIN shows error with visual feedback
   - ✅ Correct PIN unlocks and switches session
   - ✅ Browser partition isolates user data

### Test 4: Session Security & Timeout
1. **PIN Encryption**:
   - ✅ PINs stored with AES-256-GCM encryption
   - ✅ Cannot access sessions without correct PIN
2. **Auto-Lock Timeout**:
   - ✅ Sessions lock after configured timeout
   - ✅ Lock screen appears with unlock option
   - ✅ Activity resets timeout timer
3. **Session Isolation**:
   - ✅ Each user has separate cookies/storage
   - ✅ Switching users shows different login states
   - ✅ User data remains isolated between sessions

### Test 5: Session UI & UX
1. **PIN Input Enhancement**:
   - ✅ Auto-advance between PIN digits
   - ✅ Backspace navigates to previous digit
   - ✅ Enter key submits PIN
   - ✅ Auto-submit when all 4 digits entered
   - ✅ Only numeric input accepted
2. **Visual Feedback**:
   - ✅ Incorrect PIN shows shake animation
   - ✅ Lock screen shows session name
   - ✅ Clear error messages for invalid inputs
3. **Session Management Interface**:
   - ✅ Session cards show status (Active/Locked/Available)
   - ✅ Delete confirmation prevents accidental removal
   - ✅ Cannot delete currently active session

## Navigation & Toolbar Tests

### Test 6: Toolbar Functionality
1. **Navigation Buttons**:
   - ✅ Back/Forward work correctly (Alt+←/→)
   - ✅ Refresh reloads current page (F5)
   - ✅ Home returns to base URL (Ctrl+H)
2. **Print Functions**:
   - ✅ Print button opens system dialog (Ctrl+P)
   - ✅ Print functionality works with network printers
3. **Dynamic Button Visibility**:
   - ✅ Session button hidden in single-user mode
   - ✅ Session button visible in multi-user mode
   - ✅ Updates immediately when settings change

### Test 7: Settings Window Integration
1. **Settings Access**:
   - ✅ Settings button opens configuration window (⚙)
   - ✅ Keyboard shortcut works (Ctrl+,)
2. **Settings Persistence**:
   - ✅ All settings saved to electron-store
   - ✅ Settings restored on application restart
3. **Real-time Updates**:
   - ✅ Main window receives settings changes
   - ✅ Toolbar updates reflect setting changes
   - ✅ No duplicate update messages

## Error Handling & Edge Cases

### Test 8: Connection & Error Handling
1. **Server Connection**:
   - ✅ Connection test works in settings
   - ✅ Error page appears for invalid URLs
   - ✅ Retry functionality works correctly
2. **Session Error Handling**:
   - ✅ Invalid PIN attempts handled gracefully
   - ✅ Session creation errors show clear messages
   - ✅ Network errors don't crash session management

### Test 9: Data Validation
1. **Settings Validation**:
   - ✅ URL format validation
   - ✅ Session timeout range validation (5-120 minutes)
   - ✅ Invalid inputs show appropriate errors
2. **Session Validation**:
   - ✅ Session name length limits enforced
   - ✅ PIN format validation (4 digits only)
   - ✅ Duplicate session name prevention

## Performance & Stability Tests

### Test 10: Memory & Resource Management
1. **Session Cleanup**:
   - ✅ Old sessions cleaned up after 3 days
   - ✅ Session timers cleared properly
   - ✅ No memory leaks in session switching
2. **Window Management**:
   - ✅ Window state persisted correctly
   - ✅ Settings window closes properly
   - ✅ No orphaned processes after quit

## Regression Tests

### Test 11: Settings Update Regression
**Critical**: Ensure these specific issues are resolved:
1. **Session Button Visibility**:
   - ✅ Button hides immediately when session management disabled
   - ✅ Button shows immediately when session management enabled
   - ✅ No application restart required for button visibility
2. **Server URL Updates**:
   - ✅ URL changes prompt for restart
   - ✅ New URL active after restart
   - ✅ No silent failures in URL updates

## Test Results Summary

| Test Category | Tests | Status |
|---------------|-------|--------|
| Application Startup | 2 | ✅ Pass |
| Settings Management | 4 | ✅ Pass |
| Session Management | 3 | ✅ Pass |
| Navigation & Toolbar | 2 | ✅ Pass |
| Error Handling | 2 | ✅ Pass |
| Performance | 1 | ✅ Pass |
| Regression | 1 | ✅ Pass |
| **Total** | **15** | **✅ All Pass** |

## Automated Testing Notes

For future CI/CD integration:
- Settings changes can be tested via IPC message simulation
- Session management can be tested with mock PIN validation
- UI state changes can be verified through DOM queries
- Restart behavior can be mocked for automated testing 