# X (Twitter) Integration Architecture Document

## Overview
Add X (Twitter) posting capability to the existing FCC Monitor Worker, allowing filings to be posted to both Slack and X simultaneously or independently. Integration follows Option B approach: separate functions with parallel execution.

## Current Architecture Context
- **Platform**: Cloudflare Worker (serverless)
- **Storage**: Cloudflare KV for processed filing tracking + dashboard config
- **Integrations**: FCC ECFS API, Slack webhook
- **Dashboard**: Web interface for configuration management
- **Execution**: Cron-triggered with configurable frequency

## New Components Architecture

### 1. **Extended API Routes**
```
GET  /dashboard           -> Dashboard HTML page (MODIFIED: +X settings panel)
GET  /api/config          -> Get current configuration (MODIFIED: +X config)
POST /api/config          -> Update configuration (MODIFIED: +X config)
POST /api/test            -> Test template preview (UNCHANGED)
POST /api/test-send       -> Test Slack message (UNCHANGED)
POST /api/test-x          -> Test X post (NEW)
```

### 2. **KV Storage Schema Extensions**
```javascript
// EXISTING: Keep current structure
"dashboard_template" -> "template string"
"monitor_frequency_minutes" -> "60"
"processed_{filing_id}" -> "true" (with TTL)

// NEW: X Integration configuration
"x_posting_enabled" -> "true"/"false"
"x_credentials" -> "{encrypted_bearer_token}" (AES-256 encrypted)
"x_only_mode" -> "true"/"false"
"add_platform_tags" -> "true"/"false"
"posting_delay_seconds" -> "30"
"x_rate_limit_remaining" -> "300"
"x_rate_limit_reset" -> "1640995200000" (timestamp)

// NEW: X Retry Queue
"x_retry_queue" -> "[{filing_obj, attempt_count, next_retry_ts}]"
```

### 3. **Modified Components**

#### **src/index.js** (Modified)
- Add X configuration endpoints
- Add X test endpoint
- Modify `handleScheduled()` to process X retry queue
- Add parallel X posting after Slack posting

#### **src/slack.js** (Unchanged)
- Keep existing Slack functionality intact
- No modifications needed

#### **src/x-integration.js** (NEW)
- X API client with rate limiting
- Credential encryption/decryption
- Retry queue management
- Post validation and formatting

#### **src/dashboard.js** (Modified)
- Add "Social Media Settings" panel
- X configuration toggles and credential input
- Test X posting functionality

## Data Flow Changes

### **Current Flow** (Unchanged)
```
Cron Trigger -> fetchECFSFilings() -> parseECFSFiling() -> sendToSlack() -> KV tracking
```

### **New Integrated Flow**
```
Cron Trigger -> fetchECFSFilings() -> parseECFSFiling() -> 
  ├─ sendToSlack() (if enabled)
  └─ sendToX() (if enabled, with delay) -> 
     ├─ Success: mark as posted
     └─ Failure: add to retry queue
  
Next Run -> Process retry queue + new filings
```

### **X Retry Flow**
```
Cron Trigger -> 
  ├─ Process retry queue (failed X posts)
  └─ Process new filings -> both Slack + X
```

## X API Integration Design

### **Authentication**
- **Credential Storage**: Bearer Token encrypted with AES-256 in KV
- **Encryption Key**: Derived from Worker environment variable
- **API Version**: X API v2 (POST /2/tweets)

### **Rate Limiting Strategy**
```javascript
// X API Limits: 300 tweets per 15 minutes
// Strategy: Track remaining calls + reset time
const RATE_LIMIT = {
  MAX_TWEETS_PER_15MIN: 300,
  BURST_LIMIT: 10, // Max tweets per batch
  SAFETY_BUFFER: 50 // Reserve 50 calls for manual posts
};

// Before posting: Check remaining capacity
// After posting: Update counters from X response headers
// If limit exceeded: Add to retry queue
```

### **Retry Logic**
```javascript
// Retry Queue Item Structure
{
  filing: {filing_object},
  attempt_count: 2,
  next_retry_ts: 1640995200000,
  original_post_time: "2025-01-15T10:30:00Z",
  error_reason: "rate_limit_exceeded"
}

// Retry Schedule: 15min, 1hr, 4hr, 24hr, then drop
const RETRY_DELAYS = [15*60, 60*60, 4*60*60, 24*60*60]; // seconds
```

## Security Architecture

### **Credential Encryption**
```javascript
// Encryption Strategy (in x-integration.js)
async function encryptCredentials(bearerToken, env) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.ENCRYPTION_KEY), // 32-byte key from env
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(bearerToken)
  );
  
  return {
    encrypted: Array.from(new Uint8Array(encrypted)),
    iv: Array.from(iv)
  };
}
```

### **Environment Variables**
```
# Existing
ECFS_API_KEY (secret)
SLACK_WEBHOOK_URL (secret)

# New
ENCRYPTION_KEY (secret) - 32-byte key for credential encryption
```

## Dashboard Integration

### **New Social Media Settings Panel**
```html
<div class="panel">
  <h2>🐦 Social Media Settings</h2>
  
  <!-- X Integration -->
  <div class="setting-group">
    <label>
      <input type="checkbox" id="xEnabled"> Enable X (Twitter) Posting
    </label>
  </div>
  
  <div class="credential-input" id="xCredentials">
    <label>X Bearer Token:</label>
    <input type="password" id="xBearerToken" placeholder="Bearer token from X Developer Portal">
    <button onclick="saveXCredentials()">Save Credentials</button>
  </div>
  
  <!-- Advanced Options -->
  <div class="setting-group">
    <label>
      <input type="checkbox" id="xOnlyMode"> X-Only Mode (skip Slack)
    </label>
  </div>
  
  <div class="setting-group">
    <label>
      <input type="checkbox" id="addPlatformTags"> Add Platform Tags (#Slack #X)
    </label>
  </div>
  
  <div class="setting-group">
    <label>Posting Delay:</label>
    <select id="postingDelay">
      <option value="0">Simultaneous</option>
      <option value="30">30 seconds</option>
      <option value="60">1 minute</option>
      <option value="300">5 minutes</option>
    </select>
  </div>
  
  <!-- Rate Limit Status -->
  <div class="rate-limit-status">
    <span id="xRateLimit">Rate Limit: Loading...</span>
  </div>
  
  <!-- Test Buttons -->
  <div class="button-group">
    <button class="btn-primary" onclick="testXPost()">🐦 Test X Post</button>
    <button class="btn-warning" onclick="clearRetryQueue()">🔄 Clear Retry Queue</button>
  </div>
</div>
```

## File Structure Changes

```
src/
├── index.js          (MODIFIED: +X endpoints, +retry processing)
├── slack.js          (UNCHANGED)
├── x-integration.js  (NEW: X API client, encryption, retry logic)
├── dashboard.js      (MODIFIED: +social media settings panel)
├── ecfs-api.js       (UNCHANGED)
└── utils.js          (UNCHANGED)

wrangler.toml         (MODIFIED: +ENCRYPTION_KEY secret reference)
package.json          (UNCHANGED)
```

## Implementation Details

### **Core X Integration Functions**
```javascript
// src/x-integration.js
export async function sendToX(filings, env, customTemplate = null)
export async function encryptCredentials(bearerToken, env)
export async function decryptCredentials(encryptedData, env)
export async function checkRateLimit(env)
export async function updateRateLimit(responseHeaders, env)
export async function addToRetryQueue(filing, error, env)
export async function processRetryQueue(env)
export async function testXPost(template, env)
```

### **Modified Main Handler**
```javascript
// src/index.js - handleScheduled() modifications
async function handleScheduled(env) {
  try {
    // 1. Process X retry queue first
    await processRetryQueue(env);
    
    // 2. Fetch new filings (existing logic)
    const newFilings = /* existing logic */;
    
    if (newFilings.length > 0) {
      // 3. Send to platforms based on configuration
      const xEnabled = await env.FCC_MONITOR_KV.get('x_posting_enabled') === 'true';
      const xOnlyMode = await env.FCC_MONITOR_KV.get('x_only_mode') === 'true';
      const delay = parseInt(await env.FCC_MONITOR_KV.get('posting_delay_seconds') || '0');
      
      // Send to Slack (unless X-only mode)
      if (!xOnlyMode) {
        await sendToSlack(filingsToProcess, env);
      }
      
      // Send to X (if enabled)
      if (xEnabled) {
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay * 1000));
        }
        await sendToX(filingsToProcess, env);
      }
    }
  } catch (error) {
    // Existing error handling
  }
}
```

## Rate Limiting Implementation

### **Responsible Posting Strategy**
```javascript
// Conservative rate limiting
const MAX_POSTS_PER_BATCH = 5; // Even with 10 filings, max 5 X posts
const MIN_INTERVAL_BETWEEN_POSTS = 2000; // 2 seconds between posts
const RATE_LIMIT_BUFFER = 50; // Keep 50 calls in reserve

async function sendToXWithRateLimit(filings, env) {
  const rateLimit = await checkRateLimit(env);
  const availablePosts = Math.min(
    rateLimit.remaining - RATE_LIMIT_BUFFER,
    MAX_POSTS_PER_BATCH,
    filings.length
  );
  
  if (availablePosts <= 0) {
    // Add all to retry queue
    await Promise.all(filings.map(f => addToRetryQueue(f, 'rate_limit', env)));
    return;
  }
  
  // Post available filings with delays
  for (let i = 0; i < availablePosts; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, MIN_INTERVAL_BETWEEN_POSTS));
    await postSingleTweet(filings[i], env);
  }
  
  // Queue remaining filings for retry
  const remaining = filings.slice(availablePosts);
  await Promise.all(remaining.map(f => addToRetryQueue(f, 'batch_limit', env)));
}
```

## Error Handling Strategy

### **Failure Scenarios & Responses**
- **X API Down**: Add to retry queue, continue with Slack
- **Rate Limit Exceeded**: Queue for next 15-minute window
- **Invalid Credentials**: Disable X posting, notify via dashboard
- **Network Timeout**: Add to retry queue with exponential backoff
- **Message Too Long**: Truncate and post (consistent with Slack behavior)

### **Monitoring & Alerts**
```javascript
// Track success rates for dashboard metrics
"x_posts_successful_24h" -> "45"
"x_posts_failed_24h" -> "2"
"x_retry_queue_size" -> "3"
"last_x_api_error" -> "rate_limit_exceeded_2025-01-15T10:30:00Z"
```

## Testing Strategy

### **Dashboard Test Functions**
- **Test X Post**: Send sample tweet with [TEST] prefix
- **Rate Limit Check**: Display current X API quota status
- **Retry Queue Status**: Show pending posts and next retry times
- **Credential Validation**: Verify X Bearer Token works

### **Deployment Verification**
1. Deploy with X posting disabled
2. Enable X posting in dashboard
3. Test with sample template
4. Verify rate limiting works
5. Test retry queue with simulated failure

## Rollback Plan
- **Immediate**: Disable X posting via dashboard toggle
- **Emergency**: Set `x_posting_enabled` to `false` in KV directly
- **Complete**: Remove X endpoints, system reverts to Slack-only
- **Data**: Retry queue can be cleared without affecting core functionality

---

This architecture maintains full backward compatibility while adding powerful X integration. The modular approach allows X posting to be disabled without affecting existing Slack functionality, and the retry system ensures no filings are lost due to temporary API issues.