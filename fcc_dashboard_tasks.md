# Task List: 2-Hour Dashboard MVP Implementation

## 🎯 Goal
Create a functional web dashboard for template configuration and manual testing within 2 hours.

## ⏰ Time Allocation
- **Hour 1**: Core infrastructure and template system
- **Hour 2**: Dashboard UI and testing functionality

---

## 📋 **HOUR 1 TASKS (Core Infrastructure)**

### **Task 1.1: Create Dashboard HTML** (15 minutes)
- [ ] Create new file `src/dashboard.js`
- [ ] Export HTML string with basic dashboard structure
- [ ] Include:
  - Template editor (textarea)
  - Live preview div
  - Save button
  - Test button
  - Manual trigger button

**Code Template:**
```javascript
export function getDashboardHTML() {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>FCC Monitor Dashboard</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .container { max-width: 1200px; display: flex; gap: 20px; }
        .editor { flex: 1; }
        .preview { flex: 1; background: #f5f5f5; padding: 15px; }
        textarea { width: 100%; height: 200px; font-family: monospace; }
        button { padding: 10px 15px; margin: 5px; }
        .char-count { font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <h1>FCC Monitor Dashboard</h1>
      <!-- HTML structure here -->
      <script>
        // JavaScript functionality here
      </script>
    </body>
    </html>
  `;
}
```

### **Task 1.2: Add Dashboard Route** (15 minutes)
- [ ] Modify `src/index.js` 
- [ ] Add dashboard route handler in `fetch()` function
- [ ] Import dashboard HTML from `dashboard.js`

**Code to Add:**
```javascript
// At top of file
import { getDashboardHTML } from './dashboard.js';

// In fetch() function, after existing URL parsing
if (url.pathname === '/dashboard') {
  return new Response(getDashboardHTML(), {
    headers: { 'Content-Type': 'text/html' }
  });
}
```

### **Task 1.3: Add Configuration API Endpoints** (20 minutes)
- [ ] Add to `src/index.js` in `fetch()` function:
  - `GET /api/config` - return current template from KV
  - `POST /api/config` - save template to KV
  - `POST /api/test` - test template with sample data
- [ ] Handle JSON parsing and responses
- [ ] Add basic error handling

**Code to Add:**
```javascript
// Config API endpoints
if (url.pathname === '/api/config') {
  if (request.method === 'GET') {
    try {
      const template = await env.FCC_MONITOR_KV.get('dashboard_template');
      return new Response(JSON.stringify({ template: template || getDefaultTemplate() }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
  }
  
  if (request.method === 'POST') {
    try {
      const { template } = await request.json();
      await env.FCC_MONITOR_KV.put('dashboard_template', template);
      return new Response(JSON.stringify({ success: true }));
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
  }
}

if (url.pathname === '/api/test' && request.method === 'POST') {
  try {
    const { template } = await request.json();
    const sampleFiling = getSampleFiling();
    const result = applyTemplate(template, sampleFiling);
    return new Response(JSON.stringify({ preview: result, filing: sampleFiling }));
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
```

### **Task 1.4: Create Template System** (10 minutes)
- [ ] Add to `src/slack.js`:
  - `getTemplateFromKV(env)` function
  - `applyTemplate(template, filing)` function for variable substitution
  - Default template constant (current hardcoded format)

**Code to Add to src/slack.js:**
```javascript
// Default template (extract from current hardcoded format)
const DEFAULT_TEMPLATE = `🚨 NEW FCC FILING

📋 {filing_type}: {title}
🏢 {author}
📅 {date}
🔗 WC {docket}

{url}

#Lifeline #FCC`;

export async function getTemplateFromKV(env) {
  try {
    const template = await env.FCC_MONITOR_KV.get('dashboard_template');
    return template || DEFAULT_TEMPLATE;
  } catch (error) {
    console.error('Error reading template from KV:', error);
    return DEFAULT_TEMPLATE;
  }
}

export function applyTemplate(template, filing) {
  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      month: '2-digit', 
      day: '2-digit', 
      year: '2-digit' 
    });
  };

  return template
    .replace('{filing_type}', filing.filing_type || 'Filing')
    .replace('{title}', filing.title || 'Untitled')
    .replace('{author}', filing.author || 'Anonymous')
    .replace('{date}', formatDate(filing.date_received))
    .replace('{docket}', filing.docket_number || '')
    .replace('{url}', filing.filing_url || '');
}

export function getSampleFiling() {
  return {
    id: 'sample123',
    docket_number: '11-42',
    filing_type: 'COMMENT',
    title: 'Sample Public Comment',
    author: 'Example Organization',
    date_received: '2025-06-13',
    filing_url: 'https://www.fcc.gov/ecfs/search/search-filings/filing/sample123'
  };
}

export function getDefaultTemplate() {
  return DEFAULT_TEMPLATE;
}
```

---

## 📋 **HOUR 2 TASKS (Dashboard UI)**

### **Task 2.1: Implement Template Storage** (15 minutes)
- [ ] Modify `sendToSlack()` in `src/slack.js`:
  - Read template from KV using `getTemplateFromKV()`
  - Apply template using `applyTemplate()`
  - Fall back to hardcoded format if template missing
- [ ] Test KV read/write functionality

**Code Changes to sendToSlack():**
```javascript
// Replace the hardcoded tweetText creation with:
const template = await getTemplateFromKV(env);
let tweetText = applyTemplate(template, filing);

// Ensure under 240 characters by truncating if needed
if (tweetText.length > 240) {
  // Try shortening the title first
  const maxTitleLength = Math.max(15, 50 - (tweetText.length - 240));
  const shortTitle = filing.title.length > maxTitleLength 
    ? filing.title.substring(0, maxTitleLength) + '...'
    : filing.title;
  
  const updatedFiling = { ...filing, title: shortTitle };
  tweetText = applyTemplate(template, updatedFiling);
  
  // If still too long, shorten author name
  if (tweetText.length > 240) {
    const maxAuthorLength = Math.max(15, 40 - (tweetText.length - 240));
    const shortAuthor = filing.author.length > maxAuthorLength
      ? filing.author.substring(0, maxAuthorLength) + '...'
      : filing.author;
    
    const finalFiling = { ...updatedFiling, author: shortAuthor };
    tweetText = applyTemplate(template, finalFiling);
  }
}
```

### **Task 2.2: Build Template Editor** (20 minutes)
- [ ] In `src/dashboard.js`, add JavaScript for:
  - Template textarea with current value loaded
  - Character counter (240 char limit)
  - Variable help text showing available placeholders
  - Save functionality (POST to `/api/config`)

**HTML Structure:**
```html
<div class="container">
  <div class="editor">
    <h2>Template Editor</h2>
    <div class="help">
      <strong>Available Variables:</strong>
      {filing_type}, {title}, {author}, {date}, {docket}, {url}
    </div>
    <textarea id="template" placeholder="Enter your message template..."></textarea>
    <div class="char-count">
      Characters: <span id="char-count">0</span>/240
    </div>
    <button onclick="saveTemplate()">Save Template</button>
    <button onclick="testTemplate()">Test Template</button>
  </div>
  <div class="preview">
    <h2>Live Preview</h2>
    <div id="preview-content"></div>
    <button onclick="runCheck()">Run Check Now</button>
  </div>
</div>
<div id="status"></div>
```

**JavaScript Functions:**
```javascript
let currentTemplate = '';

async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    const data = await response.json();
    currentTemplate = data.template;
    document.getElementById('template').value = currentTemplate;
    updatePreview();
    updateCharCount();
  } catch (error) {
    showStatus('Error loading config: ' + error.message, 'error');
  }
}

function updateCharCount() {
  const template = document.getElementById('template').value;
  document.getElementById('char-count').textContent = template.length;
}

function updatePreview() {
  const template = document.getElementById('template').value;
  // Simple preview with sample data
  testTemplate(true);
}

async function saveTemplate() {
  const template = document.getElementById('template').value;
  try {
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template })
    });
    const result = await response.json();
    if (result.success) {
      showStatus('Template saved successfully!', 'success');
      currentTemplate = template;
    } else {
      showStatus('Error saving template: ' + result.error, 'error');
    }
  } catch (error) {
    showStatus('Error saving template: ' + error.message, 'error');
  }
}

function showStatus(message, type) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = type;
  setTimeout(() => status.textContent = '', 3000);
}

// Event listeners
document.getElementById('template').addEventListener('input', function() {
  updateCharCount();
  updatePreview();
});

// Load config on page load
loadConfig();
```

### **Task 2.3: Implement Live Preview** (15 minutes)
- [ ] Add JavaScript for live preview:
  - Sample filing data (hardcoded object)
  - Real-time template rendering as user types
  - Variable substitution preview
  - Character count validation

**JavaScript for Testing:**
```javascript
async function testTemplate(previewOnly = false) {
  const template = document.getElementById('template').value;
  try {
    const response = await fetch('/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template })
    });
    const result = await response.json();
    
    if (result.preview) {
      document.getElementById('preview-content').innerHTML = 
        `<pre>${result.preview}</pre>`;
      
      if (!previewOnly) {
        showStatus('Template test successful!', 'success');
      }
    } else {
      showStatus('Error testing template: ' + result.error, 'error');
    }
  } catch (error) {
    showStatus('Error testing template: ' + error.message, 'error');
  }
}
```

### **Task 2.4: Add Testing & Manual Trigger** (10 minutes)
- [ ] Add "Test Template" button:
  - Sends POST to `/api/test`
  - Shows success/error message
  - Displays what would be sent to Slack
- [ ] Add "Run Check Now" button:
  - Calls existing POST endpoint
  - Shows execution results

**JavaScript for Manual Trigger:**
```javascript
async function runCheck() {
  try {
    showStatus('Running check...', 'info');
    const response = await fetch('/', { method: 'POST' });
    const result = await response.json();
    
    if (result.success) {
      showStatus(`Check completed: ${result.message}`, 'success');
    } else {
      showStatus('Check failed: ' + result.error, 'error');
    }
  } catch (error) {
    showStatus('Error running check: ' + error.message, 'error');
  }
}
```

---

## ✅ **Definition of Done**

After 2 hours, you should have:
- [ ] Working dashboard at `/dashboard` URL
- [ ] Template editor that saves to KV storage
- [ ] Live preview showing template rendering
- [ ] Manual trigger button that works
- [ ] Test button that shows Slack output
- [ ] Existing worker functionality unchanged

## 🚨 **Critical Success Factors**

1. **Don't break existing functionality** - all current features must continue working
2. **Template fallback** - system works even if KV template is missing
3. **Basic validation** - prevent saving invalid templates
4. **Functional over pretty** - focus on working features, not styling

## 🔧 **Testing Checklist**

- [ ] Dashboard loads without errors
- [ ] Can save and load templates
- [ ] Live preview updates correctly
- [ ] Manual trigger still works
- [ ] Test button sends to Slack
- [ ] Worker continues running on schedule
- [ ] Fallback works when KV is empty

## 📝 **Additional Notes**

### **Import Statements to Add:**
```javascript
// src/index.js
import { getDashboardHTML } from './dashboard.js';
import { getTemplateFromKV, applyTemplate, getSampleFiling, getDefaultTemplate } from './slack.js';
```

### **CSS Classes for Status Messages:**
```css
.success { color: green; }
.error { color: red; }
.info { color: blue; }
```

### **Deployment Command:**
```bash
npm run deploy
```

---

**Ready to start? Begin with Task 1.1 and work sequentially through the list!**

## 🕐 **Time Tracking**
- [ ] Hour 1 Start: ____
- [ ] Task 1.1 Complete: ____
- [ ] Task 1.2 Complete: ____
- [ ] Task 1.3 Complete: ____
- [ ] Task 1.4 Complete: ____
- [ ] Hour 2 Start: ____
- [ ] Task 2.1 Complete: ____
- [ ] Task 2.2 Complete: ____
- [ ] Task 2.3 Complete: ____
- [ ] Task 2.4 Complete: ____
- [ ] Final Testing: ____