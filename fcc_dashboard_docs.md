# Architecture Document: FCC Monitor Dashboard (2-Hour MVP)

## Overview
Add a web-based configuration dashboard to the existing FCC Monitor Worker, allowing real-time template editing and manual trigger capabilities without code deployments.

## Current Architecture Context
- **Platform**: Cloudflare Worker (serverless)
- **Storage**: Cloudflare KV for processed filing tracking
- **Integrations**: FCC ECFS API, Slack webhook
- **Execution**: Cron-triggered (hourly)
- **Code Structure**: Modular ES6 (ecfs-api.js, slack.js, utils.js, index.js)

## New Components Architecture

### 1. **Extended Worker Routes**
```
GET  /                    -> Health check (existing)
POST /                    -> Manual trigger (existing)
GET  /dashboard           -> Dashboard HTML page (NEW)
GET  /api/config          -> Get current configuration (NEW)
POST /api/config          -> Update configuration (NEW)
POST /api/test            -> Test template with sample data (NEW)
```

### 2. **KV Storage Schema Extensions**
```javascript
// NEW: Configuration storage
"dashboard_template" -> "🚨 NEW FCC FILING\n\n📋 {filing_type}: {title}\n🏢 {author}..."
"dashboard_sample_data" -> {filing object for preview}

// EXISTING: Keep current structure
"processed_{filing_id}" -> "true" (with TTL)
```

### 3. **Modified Components**

#### **src/index.js** (Modified)
- Add dashboard route handler
- Add API endpoints for config management
- Keep existing scheduled/fetch handlers intact

#### **src/slack.js** (Modified)
- Add `getTemplateFromKV()` function
- Add `applyTemplate()` function for variable substitution
- Modify `sendToSlack()` to use dynamic templates
- Keep existing message structure as fallback

#### **src/dashboard.js** (NEW)
- Static HTML/CSS/JS for dashboard UI
- Template editor with live preview
- Configuration management interface

## Data Flow Changes

### **Current Flow** (Unchanged)
```
Cron Trigger -> fetchECFSFilings() -> parseECFSFiling() -> sendToSlack() -> KV tracking
```

### **New Configuration Flow**
```
Dashboard UI -> POST /api/config -> KV storage -> Worker reads on next execution
```

### **New Manual Testing Flow**
```
Dashboard UI -> POST /api/test -> Apply template -> Send to Slack -> Return result
```

## Template System Design

### **Variable Substitution**
```javascript
// Template format
"🚨 NEW FCC FILING\n\n📋 {filing_type}: {title}\n🏢 {author}\n📅 {date}\n🔗 WC {docket}\n\n{url}\n\n#Lifeline #FCC"

// Available variables from parseECFSFiling()
{filing_type}  -> filing.filing_type
{title}        -> filing.title  
{author}       -> filing.author
{date}         -> formatDate(filing.date_received)
{docket}       -> filing.docket_number
{url}          -> filing.filing_url
```

### **Fallback Strategy**
- If KV template missing: use hardcoded default
- If variable missing: show placeholder text
- If template invalid: revert to current hardcoded format

## Security Considerations

### **Phase 1 (2-Hour MVP)**
- **No authentication** (internal tool assumption)
- **Input validation** on template content
- **XSS prevention** in dashboard HTML

### **Future Phases**
- Basic auth via Worker secrets
- Rate limiting on API endpoints
- Template validation and sanitization

## Performance Impact

### **Minimal Overhead**
- **KV reads**: 1 additional read per worker execution
- **Response time**: <50ms additional latency
- **Storage**: <1KB per template configuration
- **Cost**: Negligible KV storage increase

## Deployment Strategy

### **Zero-Downtime Approach**
1. Add new routes without affecting existing functionality
2. Template system falls back to hardcoded format if KV empty
3. Existing cron execution continues unchanged
4. Dashboard accessible immediately after deployment

### **Testing Strategy**
- Manual trigger endpoint for immediate testing
- Template preview with sample data
- Fallback validation with missing KV data

## File Structure Changes

```
src/
├── index.js          (MODIFIED: +dashboard routes, +API endpoints)
├── slack.js          (MODIFIED: +template system)
├── dashboard.js      (NEW: dashboard HTML/CSS/JS)
├── ecfs-api.js       (UNCHANGED)
└── utils.js          (UNCHANGED)

wrangler.toml         (UNCHANGED)
package.json          (UNCHANGED)
```

## Error Handling Strategy

### **Dashboard Errors**
- Invalid template format: Show validation error
- KV write failure: Show save error with retry option
- Slack test failure: Display API error details

### **Worker Execution Errors**
- Template read failure: Fall back to hardcoded format
- Variable substitution failure: Use original parsing
- Maintain existing error logging in console

## Rollback Plan
- **Immediate**: Remove dashboard routes, system reverts to original behavior
- **Template issues**: Clear KV template, worker uses hardcoded fallback
- **KV failure**: Worker continues with original hardcoded logic

---

This architecture maintains full backward compatibility while adding powerful configuration capabilities. The modular approach allows incremental enhancement without disrupting the core monitoring functionality.

---

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

### **Task 1.2: Add Dashboard Route** (15 minutes)
- [ ] Modify `src/index.js` 
- [ ] Add dashboard route handler in `fetch()` function:
  ```javascript
  if (url.pathname === '/dashboard') {
    return new Response(getDashboardHTML(), {
      headers: { 'Content-Type': 'text/html' }
    });
  }
  ```
- [ ] Import dashboard HTML from `dashboard.js`

### **Task 1.3: Add Configuration API Endpoints** (20 minutes)
- [ ] Add to `src/index.js` in `fetch()` function:
  - `GET /api/config` - return current template from KV
  - `POST /api/config` - save template to KV
  - `POST /api/test` - test template with sample data
- [ ] Handle JSON parsing and responses
- [ ] Add basic error handling

### **Task 1.4: Create Template System** (10 minutes)
- [ ] Add to `src/slack.js`:
  - `getTemplateFromKV(env)` function
  - `applyTemplate(template, filing)` function for variable substitution
  - Default template constant (current hardcoded format)

---

## 📋 **HOUR 2 TASKS (Dashboard UI)**

### **Task 2.1: Implement Template Storage** (15 minutes)
- [ ] Modify `sendToSlack()` in `src/slack.js`:
  - Read template from KV using `getTemplateFromKV()`
  - Apply template using `applyTemplate()`
  - Fall back to hardcoded format if template missing
- [ ] Test KV read/write functionality

### **Task 2.2: Build Template Editor** (20 minutes)
- [ ] In `src/dashboard.js`, add JavaScript for:
  - Template textarea with current value loaded
  - Character counter (240 char limit)
  - Variable help text showing available placeholders
  - Save functionality (POST to `/api/config`)

### **Task 2.3: Implement Live Preview** (15 minutes)
- [ ] Add JavaScript for live preview:
  - Sample filing data (hardcoded object)
  - Real-time template rendering as user types
  - Variable substitution preview
  - Character count validation

### **Task 2.4: Add Testing & Manual Trigger** (10 minutes)
- [ ] Add "Test Template" button:
  - Sends POST to `/api/test`
  - Shows success/error message
  - Displays what would be sent to Slack
- [ ] Add "Run Check Now" button:
  - Calls existing POST endpoint
  - Shows execution results

---

## 🛠 **Implementation Details**

### **Required File Changes:**

#### **1. src/index.js** (Modifications)
```javascript
// Add these imports
import { getDashboardHTML } from './dashboard.js';

// Add in fetch() function
const url = new URL(request.url);

// Dashboard route
if (url.pathname === '/dashboard') {
  return new Response(getDashboardHTML(), {
    headers: { 'Content-Type': 'text/html' }
  });
}

// Config API routes
if (url.pathname === '/api/config') {
  if (request.method === 'GET') {
    // Return current template from KV
  }
  if (request.method === 'POST') {
    // Save template to KV
  }
}

if (url.pathname === '/api/test') {
  // Test template with sample data
}
```

#### **2. src/slack.js** (Modifications)
```javascript
// Add template functions
export async function getTemplateFromKV(env) {
  return await env.FCC_MONITOR_KV.get('dashboard_template') || DEFAULT_TEMPLATE;
}

export function applyTemplate(template, filing) {
  return template
    .replace('{filing_type}', filing.filing_type)
    .replace('{title}', filing.title)
    .replace('{author}', filing.author)
    // ... etc
}

// Modify sendToSlack()
const template = await getTemplateFromKV(env);
const tweetText = applyTemplate(template, filing);
```

#### **3. src/dashboard.js** (New File)
```javascript
export function getDashboardHTML() {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>FCC Monitor Dashboard</title>
      <style>/* Basic CSS */</style>
    </head>
    <body>
      <!-- Dashboard HTML -->
      <script>/* Dashboard JavaScript */</script>
    </body>
    </html>
  `;
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

---

**Ready to start? Begin with Task 1.1 and work sequentially through the list!**