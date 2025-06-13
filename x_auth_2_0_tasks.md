# X API 2.0 Bearer Token Migration Tasks

## 🎯 Goal
Replace OAuth 1.0a authentication (4 credentials) with X API v2.0 Bearer Token authentication (single token) in 1 hour.

## ⏰ Time Allocation
- **30 minutes**: Core authentication changes in `x-integration.js`
- **20 minutes**: Dashboard UI updates in `dashboard.js`
- **10 minutes**: API endpoint updates and testing

---

## 📋 **TASK 1: Update Core Authentication (30 minutes)**

### **Task 1.1: Simplify Credential Functions** (10 minutes)
- [ ] Modify `encryptCredentials()` to handle single string instead of object
- [ ] Modify `decryptCredentials()` to return string instead of object
- [ ] Update function signatures and error handling

**Code Changes in `src/x-integration.js`:**
```javascript
// REPLACE existing encryptCredentials function:
export async function encryptCredentials(bearerToken, env) {
  if (!env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY not set in environment');
  }
  
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.ENCRYPTION_KEY.substring(0, 32)),
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(bearerToken) // Single string, not JSON
  );
  
  return JSON.stringify({
    encrypted: Array.from(new Uint8Array(encrypted)),
    iv: Array.from(iv)
  });
}

// REPLACE existing decryptCredentials function:
export async function decryptCredentials(encryptedData, env) {
  if (!env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY not set in environment');
  }
  
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
  
  return new TextDecoder().decode(decrypted); // Return string, not parsed JSON
}
```

### **Task 1.2: Remove OAuth 1.0a Functions** (5 minutes)
- [ ] Delete `generateNonce()` function
- [ ] Delete `percentEncode()` function  
- [ ] Delete `generateSignature()` function
- [ ] Delete `generateAuthHeader()` function

**Code to DELETE from `src/x-integration.js`:**
```javascript
// DELETE these entire functions:
function generateNonce() { ... }
function percentEncode(str) { ... }
async function generateSignature(method, url, params, consumerSecret, tokenSecret) { ... }
function generateAuthHeader(credentials, method, url, additionalParams = {}) { ... }
```

### **Task 1.3: Simplify Tweet Posting** (15 minutes)
- [ ] Replace OAuth 1.0a authentication in `postSingleTweet()`
- [ ] Update credential handling to use single Bearer token
- [ ] Simplify request headers and remove signature generation

**Code Changes in `postSingleTweet()` function:**
```javascript
// REPLACE the entire postSingleTweet function:
async function postSingleTweet(filing, env, customTemplate = null) {
  const encryptedCreds = await env.FCC_MONITOR_KV.get('x_credentials');
  if (!encryptedCreds) {
    throw new Error('X credentials not configured');
  }

  // Decrypt Bearer token (now returns string directly)
  const bearerToken = await decryptCredentials(encryptedCreds, env);
  const template = customTemplate || await getXTemplateFromKV(env);
  
  const tweetText = formatForX(filing, template);
  
  logMessage(`Posting to X: ${tweetText.substring(0, 50)}...`);

  const url = `${X_API_BASE}/tweets`;

  // SIMPLIFIED: Just use Bearer token authentication
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${bearerToken}`, // Simple Bearer auth
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: tweetText
    })
  });

  // Update rate limits from response headers (unchanged)
  await updateRateLimit(response.headers, env);

  if (!response.ok) {
    const error = await response.text();
    
    // Handle specific error cases (unchanged)
    if (response.status === 401) {
      throw new Error('X API authentication failed - check your Bearer token');
    } else if (response.status === 403) {
      throw new Error('X API forbidden - check your Bearer token permissions');
    } else if (response.status === 429) {
      throw new Error('X API rate limit exceeded');
    } else if (response.status >= 500) {
      throw new Error('X API server error - service temporarily unavailable');
    } else {
      throw new Error(`X API error ${response.status}: ${error}`);
    }
  }

  const result = await response.json();
  logMessage(`Successfully posted to X: Tweet ID ${result.data?.id}`);
  return result;
}
```

---

## 📋 **TASK 2: Update Dashboard UI (20 minutes)**

### **Task 2.1: Replace Credential Input Fields** (10 minutes)
- [ ] Remove 4-field credential form (API Key, API Secret, Access Token, Access Token Secret)
- [ ] Add single Bearer Token input field
- [ ] Update help text for X API v2.0

**Code Changes in `src/dashboard.js`:**
```javascript
// REPLACE the X credentials section in the dashboard HTML:

// REMOVE this entire section:
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
  <div>
    <label style="display: block; margin-bottom: 5px; font-weight: 500;">API Key:</label>
    <input type="password" id="xApiKey" placeholder="Consumer Key" 
           style="width: 100%; padding: 10px; border: 2px solid #e1e5e9; border-radius: 6px; font-size: 14px;">
  </div>
  <div>
    <label style="display: block; margin-bottom: 5px; font-weight: 500;">API Secret:</label>
    <input type="password" id="xApiSecret" placeholder="Consumer Secret" 
           style="width: 100%; padding: 10px; border: 2px solid #e1e5e9; border-radius: 6px; font-size: 14px;">
  </div>
  <div>
    <label style="display: block; margin-bottom: 5px; font-weight: 500;">Access Token:</label>
    <input type="password" id="xAccessToken" placeholder="Access Token" 
           style="width: 100%; padding: 10px; border: 2px solid #e1e5e9; border-radius: 6px; font-size: 14px;">
  </div>
  <div>
    <label style="display: block; margin-bottom: 5px; font-weight: 500;">Access Token Secret:</label>
    <input type="password" id="xAccessTokenSecret" placeholder="Access Token Secret" 
           style="width: 100%; padding: 10px; border: 2px solid #e1e5e9; border-radius: 6px; font-size: 14px;">
  </div>
</div>

// REPLACE with this simplified version:
<div style="margin-bottom: 15px;">
  <label style="display: block; margin-bottom: 8px; font-weight: 500;">X Bearer Token:</label>
  <div style="display: flex; gap: 10px;">
    <input type="password" id="xBearerToken" placeholder="Bearer token from X Developer Portal" 
           style="flex: 1; padding: 10px; border: 2px solid #e1e5e9; border-radius: 6px; font-size: 14px;">
    <button class="btn-primary" onclick="saveXCredentials()" style="white-space: nowrap;">
      💾 Save Token
    </button>
  </div>
</div>
```

### **Task 2.2: Update Help Text** (5 minutes)
- [ ] Replace OAuth 1.0a instructions with Bearer token instructions
- [ ] Update links to point to correct X Developer Portal sections

**Code Changes in help text:**
```javascript
// REPLACE the help text section:

// OLD help text:
<div style="font-size: 12px; color: #666; margin-bottom: 15px; padding: 10px; background: #f8f9fa; border-radius: 6px;">
  <strong>Get these from X Developer Portal:</strong><br>
  1. Go to <a href="https://developer.twitter.com/en/portal/dashboard" target="_blank">X Developer Portal</a><br>
  2. Select your app → Keys and Tokens<br>
  3. Generate all 4 credentials above<br>
  4. Ensure your app has "Read and Write" permissions
</div>

// NEW help text:
<div style="font-size: 12px; color: #666; margin-bottom: 15px; padding: 10px; background: #f8f9fa; border-radius: 6px;">
  <strong>Get your Bearer Token from X Developer Portal:</strong><br>
  1. Go to <a href="https://developer.twitter.com/en/portal/dashboard" target="_blank">X Developer Portal</a><br>
  2. Select your app → Keys and Tokens<br>
  3. Copy the "Bearer Token" (starts with "AAAAAAAAAxxxxxxxxxx")<br>
  4. Ensure your app has "Read and Write" permissions
</div>
```

### **Task 2.3: Simplify JavaScript Functions** (5 minutes)
- [ ] Update `saveXSettings()` to handle single Bearer token
- [ ] Remove references to 4 separate credential fields
- [ ] Simplify validation logic

**Code Changes in JavaScript section:**
```javascript
// REPLACE the saveXSettings function:
async function saveXSettings() {
  const xEnabled = document.getElementById('xEnabled').checked;
  const xBearerToken = document.getElementById('xBearerToken').value;
  const xOnlyMode = document.getElementById('xOnlyMode').checked;
  
  if (xEnabled) {
    if (!xBearerToken.trim()) {
      showStatus('Please enter your X Bearer Token', 'error');
      return;
    }
    
    // Basic Bearer token format validation
    if (!xBearerToken.startsWith('AAAAAAAAAA')) {
      showStatus('Bearer token should start with "AAAAAAAAAA"', 'warning');
    }
  }
  
  try {
    const requestBody = {
      xEnabled,
      xOnlyMode
    };
    
    // Send Bearer token if provided
    if (xBearerToken.trim()) {
      requestBody.xBearerToken = xBearerToken.trim();
    }
    
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    
    const result = await response.json();
    if (result.success) {
      showStatus('X settings saved successfully!', 'success');
      // Clear the token field after successful save
      document.getElementById('xBearerToken').value = '';
      // Update status
      updateXStatus(true, xEnabled);
    } else {
      showStatus('Error saving X settings: ' + result.error, 'error');
    }
  } catch (error) {
    showStatus('Error saving X settings: ' + error.message, 'error');
  }
}

// UPDATE saveXCredentials function name (since it's now just the token):
async function saveXCredentials() {
  // Just call saveXSettings since token is saved with other settings
  await saveXSettings();
}
```

---

## 📋 **TASK 3: Update API Endpoints (10 minutes)**

### **Task 3.1: Modify Configuration API** (5 minutes)
- [ ] Update `/api/config` POST handler to accept `xBearerToken`
- [ ] Remove references to OAuth 1.0a credential object
- [ ] Update credential validation

**Code Changes in `src/index.js`:**
```javascript
// MODIFY the /api/config POST endpoint section:

if (url.pathname === '/api/config' && request.method === 'POST') {
  try {
    const { 
      template, 
      frequency, 
      xEnabled, 
      xOnlyMode, 
      xBearerToken  // Changed from xCredentials object to single token
    } = await request.json();

    // Existing template and frequency saves (unchanged)...
    if (template !== undefined) {
      await env.FCC_MONITOR_KV.put('dashboard_template', template);
    }
    if (frequency !== undefined) {
      await env.FCC_MONITOR_KV.put('monitor_frequency_minutes', frequency.toString());
    }

    // X configuration saves (simplified)
    if (xEnabled !== undefined) {
      await env.FCC_MONITOR_KV.put('x_posting_enabled', xEnabled.toString());
    }
    if (xOnlyMode !== undefined) {
      await env.FCC_MONITOR_KV.put('x_only_mode', xOnlyMode.toString());
    }
    
    // SIMPLIFIED: Single Bearer token instead of credentials object
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
```

### **Task 3.2: Update Test Functions** (5 minutes)
- [ ] Verify `testXPost()` function works with new Bearer token auth
- [ ] Update error messages to reference Bearer token instead of OAuth credentials
- [ ] Test credential validation

**Code Changes in `testXPost()` function:**
```javascript
// UPDATE testXPost function in src/x-integration.js (minor changes):
export async function testXPost(env, customTemplate = null) {
  const sampleFiling = {
    id: 'test123',
    docket_number: '11-42',
    filing_type: 'TEST',
    title: '[TEST] Sample FCC Filing for X Integration',
    author: 'FCC Monitor Test System',
    date_received: new Date().toISOString().split('T')[0],
    filing_url: 'https://www.fcc.gov/ecfs/search/search-filings/filing/test123'
  };

  try {
    const result = await postSingleTweet(sampleFiling, env, customTemplate);
    return { 
      success: true, 
      tweetId: result.data?.id,
      message: 'Test tweet posted successfully with Bearer token',
      preview: formatForX(sampleFiling, customTemplate || await getXTemplateFromKV(env))
    };
  } catch (error) {
    // UPDATE error message to reference Bearer token
    if (error.message.includes('authentication failed')) {
      return { 
        success: false, 
        error: 'Bearer token authentication failed - check your token is valid',
        preview: formatForX(sampleFiling, customTemplate || await getXTemplateFromKV(env))
      };
    }
    
    return { 
      success: false, 
      error: error.message,
      preview: formatForX(sampleFiling, customTemplate || await getXTemplateFromKV(env))
    };
  }
}
```

---

## ✅ **Definition of Done**

After 1 hour, you should have:
- [ ] Single Bearer token input instead of 4 OAuth credential fields
- [ ] Simplified authentication using Bearer token instead of OAuth signatures
- [ ] All existing functionality working (posting, testing, retry queue)
- [ ] Updated help text referencing X API v2.0 Bearer Token
- [ ] Proper error handling for Bearer token authentication

## 🚨 **Critical Success Factors**

1. **Maintain functionality** - all X posting features continue working
2. **Secure storage** - Bearer token properly encrypted in KV
3. **Simplified UX** - single token input is much easier to use
4. **Proper validation** - Bearer token format validation
5. **Error handling** - clear error messages for authentication failures

## 🔧 **Testing Checklist**

- [ ] Dashboard shows single Bearer token input field
- [ ] Can save Bearer token and it gets encrypted in KV
- [ ] Test X post button works with Bearer token authentication
- [ ] Regular scheduled posts work with Bearer token
- [ ] Error messages reference Bearer token instead of OAuth
- [ ] Invalid Bearer token shows helpful error message

## 📝 **Migration Notes**

### **For Users with Existing OAuth 1.0a Setup:**
- Existing OAuth 1.0a credentials will stop working after this update
- Users need to get a Bearer token from X Developer Portal
- Dashboard will show "X credentials not configured" until Bearer token is added

### **Bearer Token Format:**
- Should start with "AAAAAAAAAA"
- Much longer than OAuth credentials (100+ characters)
- Get from X Developer Portal → Your App → Keys and Tokens → Bearer Token

---

**Ready to start? Begin with Task 1.1 and work through sequentially!**

## 🕐 **Time Tracking**
- [ ] Start Time: ____
- [ ] Task 1.1 Complete: ____
- [ ] Task 1.2 Complete: ____
- [ ] Task 1.3 Complete: ____
- [ ] Task 2.1 Complete: ____
- [ ] Task 2.2 Complete: ____
- [ ] Task 2.3 Complete: ____
- [ ] Task 3.1 Complete: ____
- [ ] Task 3.2 Complete: ____
- [ ] Final Testing: ____