export function getDashboardHTML() {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>FCC Monitor Dashboard</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          color: #333;
        }
        
        .login-container {
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          padding: 20px;
        }
        
        .login-box {
          background: white;
          padding: 40px;
          border-radius: 10px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.2);
          text-align: center;
          min-width: 300px;
        }
        
        .login-box h2 {
          margin-bottom: 30px;
          color: #333;
        }
        
        .main-container {
          max-width: 1400px;
          margin: 0 auto;
          padding: 20px;
          display: none;
        }
        
        .header {
          background: white;
          padding: 20px;
          border-radius: 10px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          margin-bottom: 20px;
          text-align: center;
        }
        
        .header h1 {
          color: #333;
          margin-bottom: 5px;
        }
        
        .header p {
          color: #666;
          font-size: 14px;
        }
        
        .dashboard {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          margin-bottom: 20px;
        }
        
        .panel {
          background: white;
          padding: 25px;
          border-radius: 10px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        
        .panel h2 {
          margin-bottom: 20px;
          color: #333;
          font-size: 18px;
          border-bottom: 2px solid #f0f0f0;
          padding-bottom: 10px;
        }
        
        .help-text {
          background: #f8f9fa;
          padding: 15px;
          border-radius: 8px;
          margin-bottom: 15px;
          font-size: 13px;
          color: #666;
          border-left: 4px solid #667eea;
        }
        
        .help-text strong {
          color: #333;
          display: block;
          margin-bottom: 5px;
        }
        
        .variables {
          font-family: 'Monaco', 'Menlo', monospace;
          font-size: 12px;
          color: #667eea;
        }
        
        textarea {
          width: 100%;
          height: 200px;
          padding: 15px;
          border: 2px solid #e1e5e9;
          border-radius: 8px;
          font-family: 'Monaco', 'Menlo', monospace;
          font-size: 13px;
          resize: vertical;
          transition: border-color 0.3s;
        }
        
        textarea:focus {
          outline: none;
          border-color: #667eea;
        }
        
        .char-counter {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin: 10px 0 20px 0;
          font-size: 12px;
        }
        
        .char-count {
          color: #666;
        }
        
        .char-count.warning {
          color: #ff6b6b;
          font-weight: bold;
        }
        
        .char-limit {
          color: #999;
        }
        
        .button-group {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        
        button {
          padding: 12px 20px;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.3s;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .btn-primary {
          background: #667eea;
          color: white;
        }
        
        .btn-primary:hover {
          background: #5a6fd8;
          transform: translateY(-1px);
        }
        
        .btn-success {
          background: #51cf66;
          color: white;
        }
        
        .btn-success:hover {
          background: #40c057;
          transform: translateY(-1px);
        }
        
        .btn-warning {
          background: #ffd43b;
          color: #333;
        }
        
        .btn-warning:hover {
          background: #ffcc02;
          transform: translateY(-1px);
        }
        
        .preview-content {
          background: #f8f9fa;
          padding: 20px;
          border-radius: 8px;
          border: 1px solid #e9ecef;
          min-height: 200px;
          font-family: system-ui, sans-serif;
          line-height: 1.5;
          white-space: pre-wrap;
        }
        
        .preview-content.empty {
          color: #999;
          font-style: italic;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .status {
          position: fixed;
          top: 20px;
          right: 20px;
          padding: 15px 20px;
          border-radius: 8px;
          color: white;
          font-weight: 500;
          z-index: 1000;
          transform: translateX(400px);
          transition: transform 0.3s;
          max-width: 300px;
        }
        
        .status.show {
          transform: translateX(0);
        }
        
        .status.success {
          background: #51cf66;
        }
        
        .status.error {
          background: #ff6b6b;
        }
        
        .status.info {
          background: #339af0;
        }
        
        .actions-panel {
          grid-column: 1 / -1;
        }
        
        .actions-panel .button-group {
          justify-content: center;
        }
        
        input[type="password"] {
          width: 100%;
          padding: 12px;
          border: 2px solid #e1e5e9;
          border-radius: 6px;
          font-size: 14px;
          margin-bottom: 20px;
        }
        
        input[type="password"]:focus {
          outline: none;
          border-color: #667eea;
        }
        
        @media (max-width: 768px) {
          .dashboard {
            grid-template-columns: 1fr;
          }
          
          .button-group {
            flex-direction: column;
          }
          
          button {
            justify-content: center;
          }
        }
      </style>
    </head>
    <body>
      <div class="login-container" id="loginContainer">
        <div class="login-box">
          <h2>🔒 FCC Monitor Dashboard</h2>
          <input type="password" id="passwordInput" placeholder="Enter password" />
          <button class="btn-primary" onclick="authenticate()" style="width: 100%;">
            Login
          </button>
        </div>
      </div>

      <div class="main-container" id="mainContainer">
        <div class="header">
          <h1>📊 FCC Monitor Dashboard</h1>
          <p>Configure message templates and manage your FCC filing monitoring</p>
        </div>
        
        <div class="dashboard">
          <div class="panel">
            <h2>✏️ Template Editor</h2>
            <div class="help-text">
              <strong>Available Variables:</strong>
              <div class="variables">
                {filing_type} {title} {author} {date} {docket} {url}
              </div>
            </div>
            <textarea id="template" placeholder="Enter your message template here..."></textarea>
            <div class="char-counter">
              <span class="char-count" id="charCount">0</span>
              <span class="char-limit">/ 240 characters</span>
            </div>
            <div class="button-group">
              <button class="btn-primary" onclick="saveTemplate()">
                💾 Save Template
              </button>
              <button class="btn-success" onclick="testTemplate()">
                🧪 Test Template
              </button>
              <button class="btn-warning" onclick="testAndSendToSlack()">
                🚀 Test & Send to Slack
              </button>
            </div>
          </div>
          
          <div class="panel">
            <h2>👀 Live Preview</h2>
            <div class="preview-content empty" id="previewContent">
              Enter a template to see the preview...
            </div>
          </div>
          
          <div class="panel">
            <h2>⏱️ Check Frequency</h2>
            <select id="frequencySelect" style="width: 100%; padding: 12px; border: 2px solid #e1e5e9; border-radius: 6px; font-size: 14px; margin-bottom: 20px;">
              <option value="30">Every 30 minutes</option>
              <option value="60">Every 1 hour</option>
              <option value="360">Every 6 hours</option>
              <option value="720">Every 12 hours</option>
            </select>
            <button class="btn-primary" style="width: 100%;" onclick="saveFrequency()">
              💾 Save Frequency
            </button>
          </div>
          
          <div class="panel">
            <h2>🐦 X (Twitter) Settings</h2>
            <div class="help-text">
              <strong>Configure X (Twitter) posting:</strong>
              Enable posting to X alongside or instead of Slack notifications.
            </div>
            
            <div style="margin-bottom: 15px;">
              <label style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                <input type="checkbox" id="xEnabled" onchange="toggleXSettings()">
                <span>Enable X (Twitter) Posting</span>
              </label>
            </div>
            
            <div id="xSettingsPanel" style="display: none;">
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
              <div style="font-size: 12px; color: #666; margin-bottom: 15px; padding: 10px; background: #f8f9fa; border-radius: 6px;">
                <strong>Get these from X Developer Portal:</strong><br>
                1. Go to <a href="https://developer.twitter.com/en/portal/dashboard" target="_blank">X Developer Portal</a><br>
                2. Select your app → Keys and Tokens<br>
                3. Generate all 4 credentials above<br>
                4. Ensure your app has "Read and Write" permissions
              </div>
              
              <div style="margin-bottom: 15px;">
                <label style="display: flex; align-items: center; gap: 10px;">
                  <input type="checkbox" id="xOnlyMode">
                  <span>X-Only Mode (skip Slack)</span>
                </label>
              </div>
              
              <div class="button-group">
                <button class="btn-primary" onclick="saveXSettings()">
                  💾 Save X Settings
                </button>
                <button class="btn-success" onclick="testXPost()">
                  🧪 Test X Post
                </button>
              </div>
            </div>
            
            <div id="xStatus" style="margin-top: 10px; font-size: 12px;"></div>
          </div>
          
          <div class="panel actions-panel">
            <h2>⚡ Quick Actions</h2>
            <div class="button-group">
              <button class="btn-warning" onclick="runCheck()">
                🚀 Run Check Now
              </button>
              <button class="btn-primary" onclick="resetTemplate()">
                🔄 Reset to Default
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <div class="status" id="status"></div>

      <script>
        let currentTemplate = '';
        let isAuthenticated = false;

        // Authentication
        function authenticate() {
          const password = document.getElementById('passwordInput').value;
          if (password === '1234') {
            isAuthenticated = true;
            document.getElementById('loginContainer').style.display = 'none';
            document.getElementById('mainContainer').style.display = 'block';
            loadConfig();
          } else {
            showStatus('Invalid password', 'error');
          }
        }

        // Allow Enter key in password field
        document.addEventListener('DOMContentLoaded', function() {
          document.getElementById('passwordInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
              authenticate();
            }
          });
        });

        // Load current configuration
        async function loadConfig() {
          if (!isAuthenticated) return;
          
          try {
            const response = await fetch('/api/config');
            const data = await response.json();
            currentTemplate = data.template || '';
            document.getElementById('template').value = currentTemplate;
            // Set current frequency selection
            const freqSelect = document.getElementById('frequencySelect');
            if (freqSelect && data.frequency) {
              freqSelect.value = data.frequency.toString();
            }
            
            // Load X settings
            const xEnabled = document.getElementById('xEnabled');
            const xOnlyMode = document.getElementById('xOnlyMode');
            if (xEnabled) {
              xEnabled.checked = data.xEnabled || false;
              toggleXSettings(); // Show/hide panel based on enabled state
            }
            if (xOnlyMode) {
              xOnlyMode.checked = data.xOnlyMode || false;
            }
            
            // Update X status
            updateXStatus(data.xCredentialsSet, data.xEnabled);
            
            updateCharCount();
            updatePreview();
          } catch (error) {
            showStatus('Error loading config: ' + error.message, 'error');
          }
        }

        // Update character count and validation
        function updateCharCount() {
          const template = document.getElementById('template').value;
          const charCount = document.getElementById('charCount');
          charCount.textContent = template.length;
          
          if (template.length > 240) {
            charCount.classList.add('warning');
          } else {
            charCount.classList.remove('warning');
          }
        }

        // Update live preview
        function updatePreview() {
          const template = document.getElementById('template').value;
          if (!template.trim()) {
            document.getElementById('previewContent').innerHTML = 'Enter a template to see the preview...';
            document.getElementById('previewContent').classList.add('empty');
            return;
          }
          
          testTemplate(true);
        }

        // Save template with validation
        async function saveTemplate() {
          const template = document.getElementById('template').value;
          
          // Enforce 240 character limit at save time
          if (template.length > 240) {
            showStatus('Template exceeds 240 character limit. Please shorten it.', 'error');
            return;
          }
          
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

        // Save frequency setting
        async function saveFrequency() {
          const freq = document.getElementById('frequencySelect').value;
          try {
            const response = await fetch('/api/config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ frequency: parseInt(freq, 10) })
            });
            const result = await response.json();
            if (result.success) {
              showStatus('Frequency updated successfully!', 'success');
            } else {
              showStatus('Error saving frequency: ' + result.error, 'error');
            }
          } catch (error) {
            showStatus('Error saving frequency: ' + error.message, 'error');
          }
        }

        // Test template (preview mode or actual test)
        async function testTemplate(previewOnly = false) {
          const template = document.getElementById('template').value;
          
          console.log('Testing template:', template);
          console.log('Preview only:', previewOnly);
          
          try {
            const response = await fetch('/api/test', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ template })
            });
            
            console.log('Response status:', response.status);
            console.log('Response ok:', response.ok);
            
            const result = await response.json();
            console.log('Response data:', result);
            
            if (result.preview) {
              const previewContent = document.getElementById('previewContent');
              previewContent.textContent = result.preview;
              previewContent.classList.remove('empty');
              
              if (!previewOnly) {
                showStatus('Template test successful!', 'success');
              }
            } else {
              console.error('No preview in result:', result);
              showStatus('Error testing template: ' + (result.error || 'No preview returned'), 'error');
            }
          } catch (error) {
            console.error('Fetch error:', error);
            showStatus('Error testing template: ' + error.message, 'error');
          }
        }

        // Test template and send to Slack
        async function testAndSendToSlack() {
          const template = document.getElementById('template').value;
          
          if (!template.trim()) {
            showStatus('Please enter a template first', 'error');
            return;
          }
          
          console.log('Testing and sending to Slack:', template);
          
          try {
            showStatus('Sending test message to Slack...', 'info');
            
            const response = await fetch('/api/test-send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ template })
            });
            
            console.log('Test-send response status:', response.status);
            
            const result = await response.json();
            console.log('Test-send response data:', result);
            
            if (result.success) {
              // Update preview with what was sent
              if (result.preview) {
                const previewContent = document.getElementById('previewContent');
                previewContent.textContent = result.preview;
                previewContent.classList.remove('empty');
              }
              showStatus('Test message sent to Slack successfully!', 'success');
            } else {
              showStatus('Error sending to Slack: ' + (result.error || 'Unknown error'), 'error');
            }
          } catch (error) {
            console.error('Test-send fetch error:', error);
            showStatus('Error sending to Slack: ' + error.message, 'error');
          }
        }

        // Run manual check
        async function runCheck() {
          try {
            showStatus('Running check...', 'info');
            const response = await fetch('/', { method: 'POST' });
            const result = await response.json();
            
            if (result.success) {
              showStatus('Check completed: ' + result.message, 'success');
            } else {
              showStatus('Check failed: ' + result.error, 'error');
            }
          } catch (error) {
            showStatus('Error running check: ' + error.message, 'error');
          }
        }

        // Reset to default template
        async function resetTemplate() {
          try {
            const response = await fetch('/api/config');
            const data = await response.json();
            const defaultTemplate = \`🚨 NEW FCC FILING

📋 {filing_type}: {title}
🏢 {author}
📅 {date}
🔗 WC {docket}

{url}

#Lifeline #FCC\`;
            
            document.getElementById('template').value = defaultTemplate;
            updateCharCount();
            updatePreview();
            showStatus('Template reset to default', 'info');
          } catch (error) {
            showStatus('Error resetting template: ' + error.message, 'error');
          }
        }

        // Show status message
        function showStatus(message, type) {
          const status = document.getElementById('status');
          status.textContent = message;
          status.className = \`status \${type} show\`;
          
          setTimeout(() => {
            status.classList.remove('show');
          }, 4000);
        }

        // === X (TWITTER) FUNCTIONS ===
        
        // Toggle X settings panel visibility
        function toggleXSettings() {
          const enabled = document.getElementById('xEnabled').checked;
          const panel = document.getElementById('xSettingsPanel');
          panel.style.display = enabled ? 'block' : 'none';
        }
        
        // Update X status indicator
        function updateXStatus(credentialsSet, enabled) {
          const statusDiv = document.getElementById('xStatus');
          if (!enabled) {
            statusDiv.innerHTML = '<span style="color: #999;">❌ X posting disabled</span>';
          } else if (!credentialsSet) {
            statusDiv.innerHTML = '<span style="color: #ff6b6b;">⚠️ X credentials not configured</span>';
          } else {
            statusDiv.innerHTML = '<span style="color: #51cf66;">✅ X posting configured and enabled</span>';
          }
        }
        
        // Save X settings
        async function saveXSettings() {
          const xEnabled = document.getElementById('xEnabled').checked;
          const xApiKey = document.getElementById('xApiKey').value;
          const xApiSecret = document.getElementById('xApiSecret').value;
          const xAccessToken = document.getElementById('xAccessToken').value;
          const xAccessTokenSecret = document.getElementById('xAccessTokenSecret').value;
          const xOnlyMode = document.getElementById('xOnlyMode').checked;
          
          if (xEnabled) {
            if (!xApiKey.trim() || !xApiSecret.trim() || !xAccessToken.trim() || !xAccessTokenSecret.trim()) {
              showStatus('Please enter all 4 X API credentials', 'error');
              return;
            }
          }
          
          try {
            const requestBody = {
              xEnabled,
              xOnlyMode
            };
            
            // Only send credentials if all are provided
            if (xApiKey.trim() && xApiSecret.trim() && xAccessToken.trim() && xAccessTokenSecret.trim()) {
              requestBody.xCredentials = {
                apiKey: xApiKey.trim(),
                apiSecret: xApiSecret.trim(),
                accessToken: xAccessToken.trim(),
                accessTokenSecret: xAccessTokenSecret.trim()
              };
            }
            
            const response = await fetch('/api/config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(requestBody)
            });
            
            const result = await response.json();
            if (result.success) {
              showStatus('X settings saved successfully!', 'success');
              // Clear the password fields after successful save
              document.getElementById('xApiKey').value = '';
              document.getElementById('xApiSecret').value = '';
              document.getElementById('xAccessToken').value = '';
              document.getElementById('xAccessTokenSecret').value = '';
              // Update status
              updateXStatus(true, xEnabled);
            } else {
              showStatus('Error saving X settings: ' + result.error, 'error');
            }
          } catch (error) {
            showStatus('Error saving X settings: ' + error.message, 'error');
          }
        }
        
        // Test X posting
        async function testXPost() {
          const template = document.getElementById('template').value;
          
          if (!template.trim()) {
            showStatus('Please enter a template first', 'error');
            return;
          }
          
          try {
            showStatus('Testing X post...', 'info');
            
            const response = await fetch('/api/test-x', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ template })
            });
            
            const result = await response.json();
            
            if (result.success) {
              showStatus(\`Test post sent to X successfully! Tweet ID: \${result.tweetId}\`, 'success');
              // Show preview of what was sent
              if (result.preview) {
                const previewContent = document.getElementById('previewContent');
                previewContent.textContent = \`[X POST] \${result.preview}\`;
                previewContent.classList.remove('empty');
              }
            } else {
              showStatus('X test failed: ' + result.error, 'error');
              // Still show preview even if posting failed
              if (result.preview) {
                const previewContent = document.getElementById('previewContent');
                previewContent.textContent = \`[X PREVIEW] \${result.preview}\`;
                previewContent.classList.remove('empty');
              }
            }
          } catch (error) {
            showStatus('Error testing X post: ' + error.message, 'error');
          }
        }

        // Event listeners
        document.addEventListener('DOMContentLoaded', function() {
          const templateInput = document.getElementById('template');
          if (templateInput) {
            templateInput.addEventListener('input', function() {
              updateCharCount();
              updatePreview();
            });
          }
        });
      </script>
    </body>
    </html>
  `;
} 