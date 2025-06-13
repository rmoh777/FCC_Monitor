# X API 2.0 Bearer Token Authentication Migration

## Overview
Migrate the existing X integration from OAuth 1.0a (4 credentials) to X API v2.0 Bearer Token authentication (single token). This simplifies credential management while maintaining all existing functionality.

## Current State vs Target State

### **Current Implementation (OAuth 1.0a)**
- **Credentials**: 4 separate values (API Key, API Secret, Access Token, Access Token Secret)
- **Authentication**: Complex OAuth 1.0a signature generation
- **Storage**: All 4 credentials encrypted together in KV
- **Dashboard**: 4 separate input fields

### **Target Implementation (Bearer Token)**
- **Credentials**: Single Bearer Token from X Developer Portal
- **Authentication**: Simple Authorization header with Bearer token
- **Storage**: Single encrypted token in KV  
- **Dashboard**: Single password input field

## Architecture Changes Required

### 1. **Credential Storage Schema**
```javascript
// CURRENT KV Structure
"x_credentials" -> encrypted({
  apiKey: "...",
  apiSecret: "...", 
  accessToken: "...",
  accessTokenSecret: "..."
})

// NEW KV Structure  
"x_credentials" -> encrypted("Bearer AAAAAAAAAxxxxxxxxxx")
```

### 2. **Authentication Method**
```javascript
// CURRENT: OAuth 1.0a signature generation
const authHeader = 'OAuth ' + Object.keys(authParams)
  .sort()
  .map(key => `${percentEncode(key)}="${percentEncode(authParams[key])}"`)
  .join(', ');

// NEW: Simple Bearer token
const authHeader = `Bearer ${bearerToken}`;
```

### 3. **API Endpoint Changes**
```javascript
// CURRENT: OAuth 1.0a endpoint
POST https://api.twitter.com/2/tweets

// NEW: Same endpoint, different auth
POST https://api.twitter.com/2/tweets
Authorization: Bearer AAAAAAAAAxxxxxxxxxx
```

## Files Requiring Changes

### **src/x-integration.js** (Major Changes)
- **Remove**: All OAuth 1.0a functions (`generateNonce`, `percentEncode`, `generateSignature`, `generateAuthHeader`)
- **Simplify**: `encryptCredentials()` to handle single string instead of object
- **Simplify**: `decryptCredentials()` to return string instead of object
- **Replace**: `postSingleTweet()` authentication logic

### **src/dashboard.js** (UI Changes)
- **Remove**: 4 credential input fields (API Key, API Secret, Access Token, Access Token Secret)
- **Add**: Single Bearer Token input field
- **Update**: Help text to reference X API v2.0 Bearer Token
- **Simplify**: `saveXSettings()` function

### **src/index.js** (Minor Changes)
- **Update**: `/api/config` POST handler to accept single `xBearerToken` field
- **No changes**: to other endpoints or scheduling logic

## Implementation Strategy

### **Phase 1: Update Authentication Core**
1. Replace OAuth 1.0a signature generation with Bearer token auth
2. Simplify credential encryption/decryption functions
3. Update API request headers in `postSingleTweet()`

### **Phase 2: Update Dashboard UI**
1. Replace 4-field credential form with single Bearer token input
2. Update help text and instructions
3. Simplify JavaScript credential handling

### **Phase 3: Update API Endpoints**
1. Modify `/api/config` to handle single Bearer token
2. Update credential validation logic
3. Test end-to-end flow

## Security Considerations

### **Improved Security**
- **Reduced Attack Surface**: Single credential instead of 4
- **Simpler Key Management**: One token to rotate instead of 4 credentials
- **Same Encryption**: AES-256 encryption maintained for token storage

### **Token Management**
- **Rotation**: Easier to rotate single Bearer token
- **Validation**: Simpler credential validation
- **Storage**: Same KV encryption, smaller payload

## Backward Compatibility

### **Migration Strategy**
```javascript
// Check for existing OAuth 1.0a credentials and prompt migration
const legacyCredentials = await env.FCC_MONITOR_KV.get('x_credentials_legacy');
if (legacyCredentials && !bearerToken) {
  // Show migration notice in dashboard
  showStatus('Please update to X API v2.0 Bearer Token', 'warning');
}
```

### **Fallback Plan**
- Keep OAuth 1.0a code commented out for 30 days
- Store legacy credentials in separate KV key during transition
- Allow rollback if needed

## Rate Limiting (Unchanged)

### **Same API Limits Apply**
- 300 tweets per 15 minutes for write operations
- Rate limit headers handled identically
- Retry queue logic unchanged

## Testing Strategy

### **Credential Validation**
```javascript
// Simple Bearer token validation
async function validateBearerToken(token, env) {
  const response = await fetch('https://api.twitter.com/2/users/me', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return response.ok;
}
```

### **Dashboard Testing**
1. Verify single token input saves correctly
2. Test token encryption/decryption
3. Confirm test post functionality works
4. Validate error handling for invalid tokens

## Developer Experience Improvements

### **Simplified Setup Process**
1. **Old Process**: Get 4 separate credentials from X Developer Portal
2. **New Process**: Get single Bearer Token from X Developer Portal

### **Reduced Configuration Complexity**
- **Before**: 4 fields to copy/paste correctly
- **After**: 1 field to copy/paste
- **Error Reduction**: Fewer opportunities for credential input mistakes

## Documentation Updates Required

### **Dashboard Help Text**
```html
<!-- OLD -->
<div>Get these from X Developer Portal: API Key, API Secret, Access Token, Access Token Secret</div>

<!-- NEW -->
<div>Get your Bearer Token from X Developer Portal → Project & Apps → Your App → Keys and Tokens → Bearer Token</div>
```

### **README Updates**
- Update setup instructions for Bearer Token instead of OAuth 1.0a
- Simplify credential configuration steps
- Update troubleshooting guide

## Deployment Plan

### **Zero-Downtime Migration**
1. **Deploy new code** with Bearer token support
2. **Existing OAuth 1.0a credentials** continue working during transition
3. **Dashboard shows migration notice** for OAuth 1.0a users
4. **Users update at their convenience** to Bearer token
5. **Remove OAuth 1.0a code** after 30-day transition period

### **Rollback Strategy**
- Keep OAuth 1.0a code in separate branch
- Maintain legacy credential storage for 30 days
- Can revert to OAuth 1.0a if Bearer token issues arise

---

This migration significantly simplifies the X integration while maintaining all existing functionality and providing a better developer experience.