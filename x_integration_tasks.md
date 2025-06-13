# X Integration Implementation Tasks (2-Hour Sprint)

## 🎯 Goal
Add X (Twitter) posting capability to existing FCC Monitor Worker within 2 hours, with dashboard controls and retry functionality.

## ⏰ Time Allocation
- **Hour 1**: Core X integration and API client (60 min)
- **Hour 2**: Dashboard integration and testing (60 min)

---

## 📋 **HOUR 1 TASKS (Core X Integration)**

### **Task 1.1: Create X Integration Module** (20 minutes)
- [ ] Create new file `src/x-integration.js`
- [ ] Implement credential encryption/decryption functions
- [ ] Add basic X API client with rate limiting
- [ ] Export core functions for use in other modules

**Code Template:**
```javascript
// src/x-integration.js

// Encryption functions
export async function encryptCredentials(bearerToken, env) {
  if (!env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY not set in environment');
  }
  
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.ENCRYPTION_KEY.substring(0, 32)), // Ensure 32 bytes
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
  
  return JSON.stringify({
    encrypted: Array.from(new Uint8Array(encrypted)),
    iv: Array.from(iv)
  });
}

export async function decryptCredentials(encryptedData, env) {
  const data = JSON.parse(encryptedData);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.ENCRYPTION_KEY.substring(0, 32)),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(data.iv) },
    key,
    new Uint8Array(data.encrypted)
  );
  
  return new TextDecoder().decode(decrypted);
}

// Rate limiting functions
export async function checkRateLimit(env) {
  const remaining = await env.FCC_MONITOR_KV.get('x_rate_limit_remaining');
  const reset = await env.FCC_MONITOR_KV.get('x_rate_limit_reset');
  const now = Date.now();
  
  // If reset time has passed, restore full quota
  if (!reset || now > parseInt(reset)) {
    await env.FCC_MONITOR_KV.put('x_rate_limit_remaining', '300');
    await env.FCC_MONITOR_KV.put('x_rate_limit_reset', (now + 15 * 60 * 1000).toString());
    return { remaining: 300, resetTime: now + 15 * 60 * 1000 };
  }
  
  return { 
    remaining: parseInt(remaining || '300'), 
    resetTime: parseInt(reset) 
  };
}

export async function updateRateLimit(responseHeaders, env) {
  const remaining = responseHeaders.get('x-rate-limit-remaining');
  const reset = responseHeaders.get('x-rate-limit-reset');
  
  if (remaining) {
    await env.FCC_MONITOR_KV.put('x_rate_limit_remaining', remaining);
  }
  if (reset) {
    await env.FCC_MONITOR_KV.put('x_rate_limit_reset', (parseInt(reset) * 1000).toString());
  }
}
```

### **Task 1.2: Implement Core X Posting Function** (25 minutes)
- [ ] Add `sendToX()` function that posts individual tweets
- [ ] Implement retry queue management
- [ ] Add rate limiting logic with safety buffers
- [ ] Handle X API responses and errors

**Code to Add:**
```javascript
// Continue in src/x-integration.js

export async function sendToX(filings, env, customTemplate = null) {
  const xEnabled = await env.FCC_MONITOR_KV.get('x_posting_enabled');
  if (xEnabled !== 'true') {
    console.log('X posting disabled, skipping');
    return { success: true, skipped: true };
  }

  const encryptedCreds = await env.FCC_MONITOR_KV.get('x_credentials');
  if (!encryptedCreds) {
    throw new Error('X credentials not configured');
  }

  const bearerToken = await decryptCredentials(encryptedCreds, env);
  const template = customTemplate || await env.FCC_MONITOR_KV.get('dashboard_template');
  
  // Check rate limits
  const rateLimit = await checkRateLimit(env);
  const maxPosts = Math.min(5, rateLimit.remaining - 50, filings.length); // Max 5, keep 50 buffer
  
  if (maxPosts <= 0) {
    console.log('Rate limit exceeded, adding to retry queue');
    await Promise.all(filings.map(f => addToRetryQueue(f, 'rate_limit', env)));
    return { success: true, queued: filings.length };
  }

  const results = [];
  const filingsToPost = filings.slice(0, maxPosts);
  const filingsToQueue = filings.slice(maxPosts);

  // Post tweets with delays
  for (let i = 0; i < filingsToPost.length; i++) {
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
    }
    
    try {
      const result = await postSingleTweet(filingsToPost[i], bearerToken, template, env);
      results.push({ filing: filingsToPost[i], success: true, tweetId: result.id });
    } catch (error) {
      console.error('Failed to post tweet:', error);
      await addToRetryQueue(filingsToPost[i], error.message, env);
      results.push({ filing: filingsToPost[i], success: false, error: error.message });
    }
  }

  // Queue remaining filings
  await Promise.all(filingsToQueue.map(f => addToRetryQueue(f, 'batch_limit', env)));

  return { success: true, posted: results.length, queued: filingsToQueue.length };
}

async function postSingleTweet(filing, bearerToken, template, env) {
  // Apply template (reuse from slack.js)
  const { applyTemplate } = await import('./slack.js');
  let tweetText = applyTemplate(template, filing);
  
  // Add platform tag if enabled
  const addTags = await env.FCC_MONITOR_KV.get('add_platform_tags');
  if (addTags === 'true') {
    tweetText += ' #X';
  }
  
  // Ensure under 280 characters (X limit)
  if (tweetText.length > 280) {
    tweetText = tweetText.substring(0, 277) + '...';
  }

  const response = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${bearerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: tweetText
    })
  });

  await updateRateLimit(response.headers, env);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`X API error ${response.status}: ${error}`);
  }

  return await response.json();
}

// Retry queue functions
export async function addToRetryQueue(filing, errorReason, env) {
  const queueData = await env.FCC_MONITOR_KV.get('x_retry_queue');
  const queue = queueData ? JSON.parse(queueData) : [];
  
  // Don't add duplicates
  if (queue.some(item => item.filing.id === filing.id)) {
    return;
  }
  
  const retryItem = {
    filing,
    attempt_count: 1,
    next_retry_ts: Date.now() + (15 * 60 * 1000), // 15 minutes
    original_post_time: new Date().toISOString(),
    error_reason: errorReason
  };
  
  queue.push(retryItem);
  await env.FCC_MONITOR_KV.put('x_retry_queue', JSON.stringify(queue));
}

export async function processRetryQueue(env) {
  const queueData = await env.FCC_MONITOR_KV.get('x_retry_queue');
  if (!queueData) return;
  
  const queue = JSON.parse(queueData);
  const now = Date.now();
  const readyToRetry = queue.filter(item => item.next_retry_ts <= now);
  const stillWaiting = queue.filter(item => item.next_retry_ts > now);
  
  if (readyToRetry.length > 0) {
    console.log(`Processing ${readyToRetry.length} retry items`);
    
    // Attempt to post retry items
    const filings = readyToRetry.map(item => item.filing);
    await sendToX(filings, env);
    
    // Update queue with only waiting items
    await env.FCC_MONITOR_KV.put('x_retry_queue', JSON.stringify(stillWaiting));
  }
}

export function getSampleFiling() {
  return {
    id: 'sample_x_123',
    docket_number: '11-42',
    filing_type: 'TEST COMMENT',
    title: '[TEST] Sample X Integration Post',
    author: 'FCC Monitor System',
    date_received: '2025-01-15',
    filing_url: 'https://www.fcc.gov/ecfs/search/search-filings/filing/sample_x_123'
  };
}
```

### **Task 1.3: Integrate X into Main Handler** (15 minutes)
- [ ] Modify `src/index.js` to import X functions
- [ ] Add X posting logic to `handleScheduled()`
- [ ] Add retry queue processing
- [ ] Maintain existing Slack functionality

**Code Changes to src/index.js:**
```javascript
// Add to imports at top
import { sendToX, processRetryQueue } from './x-integration.js';

// Modify handleScheduled() function
async function handleScheduled(env) {
  try {
    logMessage('Starting FCC monitoring check...');
    
    // NEW: Process X retry queue first
    await processRetryQueue(env);
    
    // Existing frequency throttling logic...
    const freqStr = await env.FCC_MONITOR_KV.get('monitor_frequency_minutes');
    // ... rest of existing logic until filings processing...
    
    if (newFilings.length > 0) {
      logMessage(`Found ${newFilings.length} truly new filings to process`);
      const filingsToProcess = newFilings.slice(0, 10);
      
      // Get X configuration
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
          logMessage(`Waiting ${delay} seconds before X posting...`);
          await new Promise(resolve => setTimeout(resolve, delay * 1000));
        }
        const xResult = await sendToX(filingsToProcess, env);
        logMessage(`X posting result: ${JSON.stringify(xResult)}`);
      }
      
      // Existing KV marking logic...
      await Promise.all(
        filingsToProcess.map(filing => 
          env.FCC_MONITOR_KV.put(`processed_${filing.id}`, 'true', {
            expirationTtl: 7 * 24 * 60 * 60
          })
        )
      );
      
      // Rest of existing return logic...
    }
  } catch (error) {
    // Existing error handling...
  }
}
```

---

## 📋 **HOUR 2 TASKS (Dashboard Integration)**

### **Task 2.1: Add X Configuration API Endpoints** (15 minutes)
- [ ] Extend `/api/config` GET to return X settings
- [ ] Extend `/api/config` POST to save X settings
- [ ] Add `/api/test-x` endpoint for testing X posts
- [ ] Add credential encryption in POST handler

**Code Changes to src/index.js:**
```javascript
// Add to imports
import { encryptCredentials, getSampleFiling as getXSampleFiling } from './x-integration.js';

// Modify /api/config GET endpoint
if (url.pathname === '/api/config' && request.method === 'GET') {
  try {
    const template = await env.FCC_MONITOR_KV.get('dashboard_template');
    const freqStr = await env.FCC_MONITOR_KV.get('monitor_frequency_minutes');
    const frequency = freqStr ? parseInt(freqStr, 10) : 60;
    
    // NEW: X configuration
    const xEnabled = await env.FCC_MONITOR_KV.get('x_posting_enabled') === 'true';
    const xOnlyMode = await env.FCC_MONITOR_KV.get('x_only_mode') === 'true';
    const addPlatformTags = await env.FCC_MONITOR_KV.get('add_platform_tags') === 'true';
    const postingDelay = parseInt(await env.FCC_MONITOR_KV.get('posting_delay_seconds') || '0');
    const hasXCredentials = !!(await env.FCC_MONITOR_KV.get('x_credentials'));
    
    return new Response(JSON.stringify({ 
      template: template || getDefaultTemplate(),
      frequency,
      xEnabled,
      xOnlyMode,
      addPlatformTags,
      postingDelay,
      hasXCredentials
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Modify /api/config POST endpoint
if (url.pathname === '/api/config' && request.method === 'POST') {
  try {
    const { 
      template, 
      frequency, 
      xEnabled, 
      xOnlyMode, 
      addPlatformTags, 
      postingDelay,
      xBearerToken 
    } = await request.json();

    // Existing template and frequency saves...
    if (template !== undefined) {
      await env.FCC_MONITOR_KV.put('dashboard_template', template);
    }
    if (frequency !== undefined) {
      await env.FCC_MONITOR_KV.put('monitor_frequency_minutes', frequency.toString());
    }

    // NEW: X configuration saves
    if (xEnabled !== undefined) {
      await env.FCC_MONITOR_KV.put('x_posting_enabled', xEnabled.toString());
    }
    if (xOnlyMode !== undefined) {
      await env.FCC_MONITOR_KV.put('x_only_mode', xOnlyMode.toString());
    }
    if (addPlatformTags !== undefined) {
      await env.FCC_MONITOR_KV.put('add_platform_tags', addPlatformTags.toString());
    }
    if (postingDelay !== undefined) {
      await env.FCC_MONITOR_KV.put('posting_delay_seconds', postingDelay.toString());
    }
    if (xBearerToken) {
      const encrypted = await encryptCredentials(xBearerToken, env);
      await env.FCC_MONITOR_KV.put('x_credentials', encrypted);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// NEW: /api/test-x endpoint
if (url.pathname === '/api/test-x' && request.method === 'POST') {
  try {
    const { template } = await request.json();
    const sampleFiling = getXSampleFiling();
    
    // Test post to X with [TEST] prefix
    const testTemplate = `[TEST] ${template || await env.FCC_MONITOR_KV.get('dashboard_template')}`;
    const result = await sendToX([sampleFiling], env, testTemplate);
    
    return new Response(JSON.stringify({ 
      success: true,
      result,
      message: 'Test post sent to X'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      success: false,
      error: error.message 
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
```

### **Task 2.2: Add Social Media Settings Panel to Dashboard** (30 minutes)
- [ ] Modify `src/dashboard.js` to add X settings panel
- [ ] Add toggles for X configuration options
- [ ] Add credential input with encryption
- [ ] Add test X post functionality

**Code Changes to src/dashboard.js:**
```javascript
// In getDashboardHTML(), add new panel after existing panels but before actions panel:

// Add to the dashboard grid (before actions-panel):
<div class="panel">
  <h2>🐦 Social Media Settings</h2>
  
  <!-- X Integration Toggle -->
  <div class="setting-group" style="margin-bottom: 15px;">
    <label style="display: flex; align-items: center; gap: 10px;">
      <input type="checkbox" id="xEnabled"> Enable X (Twitter) Posting
    </label>
  </div>
  
  <!-- Credentials -->
  <div class="credential-section" id="xCredentialSection" style="margin-bottom: 20px;">
    <label style="display: block; margin-bottom: 8px; font-weight: 500;">X Bearer Token:</label>
    <div style="display: flex; gap: 10px;">
      <input type="password" id="xBearerToken" placeholder="Bearer token from X Developer Portal" 
             style="flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
      <button class="btn-primary" onclick="saveXCredentials()" style="white-space: nowrap;">
        💾 Save
      </button>
    </div>
    <div id="credentialStatus" style="font-size: 12px; margin-top: 5px; color: #666;"></div>
  </div>
  
  <!-- Advanced Options -->
  <div class="advanced-options" style="border-top: 1px solid #eee; padding-top: 15px;">
    <div class="setting-group" style="margin-bottom: 10px;">
      <label style="display: flex; align-items: center; gap: 10px;">
        <input type="checkbox" id="xOnlyMode"> X-Only Mode (skip Slack)
      </label>
    </div>
    
    <div class="setting-group" style="margin-bottom: 15px;">
      <label style="display: flex; align-items: center; gap: 10px;">
        <input type="checkbox" id="addPlatformTags"> Add Platform Tags (#Slack #X)
      </label>
    </div>
    
    <div class="setting-group" style="margin-bottom: 15px;">
      <label style="display: block; margin-bottom: 8px; font-weight: 500;">Posting Delay:</label>
      <select id="postingDelay" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
        <option value="0">Simultaneous</option>
        <option value="30">30 seconds</option>
        <option value="60">1 minute</option>
        <option value="300">5 minutes</option>
      </select>
    </div>
  </div>
  
  <!-- Test Buttons -->
  <div class="button-group">
    <button class="btn-success" onclick="testXPost()">🐦 Test X Post</button>
    <button class="btn-warning" onclick="clearRetryQueue()">🔄 Clear Retry Queue</button>
  </div>
</div>

// Update the CSS to add:
.setting-group {
  margin-bottom: 10px;
}

.credential-section {
  background: #f8f9fa;
  padding: 15px;
  border-radius: 6px;
  border: 1px solid #e9ecef;
}

.advanced-options {
  margin-top: 15px;
}
```

### **Task 2.3: Add JavaScript Functions for X Integration** (15 minutes)
- [ ] Add functions to load X configuration
- [ ] Add save functions for X settings
- [ ] Add test X post functionality
- [ ] Update existing `loadConfig()` to handle X settings

**JavaScript to Add in dashboard.js:**
```javascript
// Modify existing loadConfig() function to include X settings:
async function loadConfig() {
  if (!isAuthenticated) return;
  
  try {
    const response = await fetch('/api/config');
    const data = await response.json();
    
    // Existing template loading...
    currentTemplate = data.template || '';
    document.getElementById('template').value = currentTemplate;
    
    // Existing frequency loading...
    const freqSelect = document.getElementById('frequencySelect');
    if (freqSelect && data.frequency) {
      freqSelect.value = data.frequency.toString();
    }
    
    // NEW: X configuration loading
    document.getElementById('xEnabled').checked = data.xEnabled || false;
    document.getElementById('xOnlyMode').checked = data.xOnlyMode || false;
    document.getElementById('addPlatformTags').checked = data.addPlatformTags || false;
    document.getElementById('postingDelay').value = data.postingDelay || '0';
    
    // Update credential status
    const credStatus = document.getElementById('credentialStatus');
    credStatus.textContent = data.hasXCredentials ? '✓ Credentials saved' : 'No credentials saved';
    credStatus.style.color = data.hasXCredentials ? '#51cf66' : '#666';
    
    updateCharCount();
    updatePreview();
  } catch (error) {
    showStatus('Error loading config: ' + error.message, 'error');
  }
}

// NEW: Save X credentials
async function saveXCredentials() {
  const bearerToken = document.getElementById('xBearerToken').value;
  if (!bearerToken.trim()) {
    showStatus('Please enter a bearer token', 'error');
    return;
  }
  
  try {
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xBearerToken: bearerToken })
    });
    
    const result = await response.json();
    if (result.success) {
      showStatus('X credentials saved successfully!', 'success');
      document.getElementById('xBearerToken').value = '';
      document.getElementById('credentialStatus').textContent = '✓ Credentials saved';
      document.getElementById('credentialStatus').style.color = '#51cf66';
    } else {
      showStatus('Error saving credentials: ' + result.error, 'error');
    }
  } catch (error) {
    showStatus('Error saving credentials: ' + error.message, 'error');
  }
}

// NEW: Save X settings when checkboxes change
document.addEventListener('DOMContentLoaded', function() {
  // Existing event listeners...
  
  // NEW: X setting change handlers
  document.getElementById('xEnabled').addEventListener('change', saveXSettings);
  document.getElementById('xOnlyMode').addEventListener('change', saveXSettings);
  document.getElementById('addPlatformTags').addEventListener('change', saveXSettings);
  document.getElementById('postingDelay').addEventListener('change', saveXSettings);
});

async function saveXSettings() {
  const xEnabled = document.getElementById('xEnabled').checked;
  const xOnlyMode = document.getElementById('xOnlyMode').checked;
  const addPlatformTags = document.getElementById('addPlatformTags').checked;
  const postingDelay = parseInt(document.getElementById('postingDelay').value);
  
  try {
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xEnabled, xOnlyMode, addPlatformTags, postingDelay })
    });
    
    const result = await response.json();
    if (result.success) {
      showStatus('X settings saved!', 'success');
    } else {
      showStatus('Error saving X settings: ' + result.error, 'error');
    }
  } catch (error) {
    showStatus('Error saving X settings: ' + error.message, 'error');
  }
}

// NEW: Test X post
async function testXPost() {
  const template = document.getElementById('template').value;
  
  if (!template.trim()) {
    showStatus('Please enter a template first', 'error');
    return;
  }
  
  try {
    showStatus('Sending test post to X...', 'info');
    
    const response = await fetch('/api/test-x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template })
    });
    
    const result = await response.json();
    
    if (result.success) {
      showStatus('Test post sent to X successfully!', 'success');
    } else {
      showStatus('Error sending to X: ' + result.error, 'error');
    }
  } catch (error) {
    showStatus('Error sending to X: ' + error.message, 'error');
  }
}

// NEW: Clear retry queue
async function clearRetryQueue() {
  try {
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clearRetryQueue: true })
    });
    showStatus('Retry queue cleared', 'success');
  } catch (error) {
    showStatus('Error clearing queue: ' + error.message, 'error');
  }
}
```

---

## ✅ **Definition of Done**

After 2 hours, you should have:
- [ ] X integration module with encryption and rate limiting
- [ ] Dashboard panel for X configuration and testing
- [ ] Retry queue system for failed posts
- [ ] Test X post functionality working
- [ ] Existing Slack functionality unchanged
- [ ] Rate limiting that respects X API limits

## 🚨 **Critical Success Factors**

1. **Don't break existing functionality** - all current Slack features must continue working
2. **Secure credential storage** - X Bearer Token properly encrypted in KV
3. **Rate limiting** - stay within X API limits (300 posts per 15 minutes)
4. **Error handling** - failed posts get queued for retry
5. **Dashboard testing** - can successfully send test tweets

## 🔧 **Final Testing Checklist**

- [ ] Dashboard loads with new X settings panel
- [ ] Can save X Bearer Token (gets encrypted in KV)
- [ ] Can toggle X posting on/off
- [ ] Test X post button sends actual tweet with [TEST] prefix
- [ ] Regular scheduled posts work with both Slack and X
- [ ] Rate limiting prevents API abuse
- [ ] Retry queue processes failed posts on next run
- [ ] X-only mode works (skips Slack)

## 📝 **Environment Setup Required**

Before starting, ensure you have:
```bash
# Add to Cloudflare Worker secrets
wrangler secret put ENCRYPTION_KEY
# Set to a random 32-character string for AES-256 encryption

# Ensure existing secrets are still set:
# ECFS_API_KEY (existing)
# SLACK_WEBHOOK_URL (existing)
```

## 🚀 **Deployment Steps**

1. Complete all tasks above
2. Test locally with `npm run dev`
3. Deploy with `npm run deploy`
4. Access dashboard and configure X credentials
5. Test with sample post before enabling for production

---

**Ready to start? Begin with Task 1.1 and work sequentially through the list!**

## 🕐 **Time Tracking**
- [ ] Hour 1 Start: ____
- [ ] Task 1.1 Complete: ____
- [ ] Task 1.2 Complete: ____
- [ ] Task 1.3 Complete: ____
- [ ] Hour 2 Start: ____
- [ ] Task 2.1 Complete: ____
- [ ] Task 2.2 Complete: ____
- [ ] Task 2.3 Complete: ____
- [ ] Final Testing: ____