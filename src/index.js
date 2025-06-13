import { fetchECFSFilings } from './ecfs-api.js';
import { sendToSlack } from './slack.js';
import { logMessage } from './utils.js';
import { getDashboardHTML } from './dashboard.js';
import { getDefaultTemplate, applyTemplate, getSampleFiling } from './slack.js';
import { sendToX, processRetryQueue, encryptCredentials, testXPost, getDefaultXTemplate } from './x-integration.js';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Dashboard route
    if (url.pathname === '/dashboard') {
      return new Response(getDashboardHTML(), {
        headers: { 'Content-Type': 'text/html' }
      });
    }
    
    // Configuration API endpoints
    if (url.pathname === '/api/config') {
      if (request.method === 'GET') {
        try {
          const template = await env.FCC_MONITOR_KV.get('dashboard_template');
          const freqStr = await env.FCC_MONITOR_KV.get('monitor_frequency_minutes');
          const frequency = freqStr ? parseInt(freqStr, 10) : 60;
          
          // X Configuration
          const xEnabled = await env.FCC_MONITOR_KV.get('x_posting_enabled');
          const xCredentialsSet = !!(await env.FCC_MONITOR_KV.get('x_credentials'));
          const xOnlyMode = await env.FCC_MONITOR_KV.get('x_only_mode');
          
          return new Response(JSON.stringify({ 
            template: template || getDefaultTemplate(),
            frequency,
            xEnabled: xEnabled === 'true',
            xCredentialsSet,
            xOnlyMode: xOnlyMode === 'true'
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
      
      if (request.method === 'POST') {
        try {
          const { 
            template, 
            frequency, 
            xEnabled, 
            xOnlyMode, 
            xOAuth2Credentials  // OAuth 2.0 Client ID and Secret
          } = await request.json();

          // Existing template and frequency saves (unchanged)
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
          
          // OAuth 2.0 credentials (Client ID and Secret)
          if (xOAuth2Credentials) {
            const encrypted = await encryptCredentials(xOAuth2Credentials, env);
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
    }
    
    // Test API endpoint
    if (url.pathname === '/api/test' && request.method === 'POST') {
      try {
        const { template } = await request.json();
        const sampleFiling = getSampleFiling();
        const result = applyTemplate(template, sampleFiling);
        return new Response(JSON.stringify({ 
          preview: result, 
          filing: sampleFiling 
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
    
    // Test X posting endpoint
    if (url.pathname === '/api/test-x' && request.method === 'POST') {
      try {
        let template = null;
        try {
          const body = await request.json();
          template = body.template;
        } catch (e) {
          // No JSON body provided, use default template
        }
        const result = await testXPost(env, template);
        return new Response(JSON.stringify(result), {
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
    
    // OAuth 2.0 authorization URL endpoint
    if (url.pathname === '/api/oauth/authorize' && request.method === 'POST') {
      try {
        const { generateAuthorizationUrl, decryptCredentials } = await import('./x-integration.js');
        
        const encryptedCreds = await env.FCC_MONITOR_KV.get('x_credentials');
        if (!encryptedCreds) {
          return new Response(JSON.stringify({ 
            success: false,
            error: 'OAuth 2.0 credentials not configured' 
          }), { 
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const credentials = await decryptCredentials(encryptedCreds, env);
        const authUrl = generateAuthorizationUrl(credentials.clientId);
        
        return new Response(JSON.stringify({ 
          success: true,
          authUrl: authUrl 
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

    // OAuth 2.0 callback endpoint
    if (url.pathname === '/api/oauth/callback' && request.method === 'GET') {
      try {
        const { exchangeCodeForToken } = await import('./x-integration.js');
        
        const authCode = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
          return new Response(`
            <html>
              <head><title>X Authorization Failed</title></head>
              <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
                <h2>❌ Authorization Failed</h2>
                <p>Error: ${error}</p>
                <p>Description: ${url.searchParams.get('error_description') || 'Unknown error'}</p>
                <script>setTimeout(() => window.close(), 3000);</script>
              </body>
            </html>
          `, { headers: { 'Content-Type': 'text/html' } });
        }

        if (!authCode) {
          throw new Error('No authorization code received');
        }

        // Exchange code for access token
        const tokenResult = await exchangeCodeForToken(authCode, env);
        
        return new Response(`
          <html>
            <head><title>X Authorization Success</title></head>
            <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
              <h2>✅ Successfully Authorized!</h2>
              <p>Your X account has been connected to FCC Monitor.</p>
              <p>You can now post tweets!</p>
              <script>
                setTimeout(() => {
                  window.opener?.postMessage('oauth_success', '*');
                  window.close();
                }, 2000);
              </script>
            </body>
          </html>
        `, { headers: { 'Content-Type': 'text/html' } });

      } catch (error) {
        return new Response(`
          <html>
            <head><title>X Authorization Error</title></head>
            <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
              <h2>❌ Authorization Error</h2>
              <p>Error: ${error.message}</p>
              <script>setTimeout(() => window.close(), 3000);</script>
            </body>
          </html>
        `, { headers: { 'Content-Type': 'text/html' } });
      }
    }

    // Debug OAuth status endpoint
    if (url.pathname === '/api/debug-oauth' && request.method === 'GET') {
      try {
        const { decryptCredentials } = await import('./x-integration.js');
        
        // Check stored credentials
        const encryptedCreds = await env.FCC_MONITOR_KV.get('x_credentials');
        const hasCredentials = !!encryptedCreds;
        let credentialsInfo = null;
        
        if (hasCredentials) {
          try {
            const creds = await decryptCredentials(encryptedCreds, env);
            credentialsInfo = {
              hasClientId: !!creds.clientId,
              hasClientSecret: !!creds.clientSecret,
              clientIdPrefix: creds.clientId ? creds.clientId.substring(0, 10) + '...' : 'none'
            };
          } catch (e) {
            credentialsInfo = { error: 'Failed to decrypt credentials' };
          }
        }
        
        // Check stored OAuth token
        const oauthToken = await env.FCC_MONITOR_KV.get('x_oauth_token');
        let tokenInfo = null;
        
        if (oauthToken) {
          try {
            const tokenData = JSON.parse(oauthToken);
            tokenInfo = {
              hasAccessToken: !!tokenData.access_token,
              hasRefreshToken: !!tokenData.refresh_token,
              tokenType: tokenData.token_type,
              expiresAt: new Date(tokenData.expires_at).toISOString(),
              isExpired: Date.now() > tokenData.expires_at
            };
          } catch (e) {
            tokenInfo = { error: 'Failed to parse token data' };
          }
        }
        
        return new Response(JSON.stringify({ 
          hasCredentials,
          credentialsInfo,
          hasOAuthToken: !!oauthToken,
          tokenInfo,
          timestamp: new Date().toISOString()
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

    // Rate limit status endpoint
    if (url.pathname === '/api/rate-limit-status' && request.method === 'GET') {
      try {
        const { checkRateLimit } = await import('./x-integration.js');
        const rateLimit = await checkRateLimit(env);
        
        return new Response(JSON.stringify({ 
          success: true,
          remaining: rateLimit.remaining,
          resetTime: new Date(rateLimit.resetTime).toISOString(),
          minutesUntilReset: Math.ceil((rateLimit.resetTime - Date.now()) / 60000),
          timestamp: new Date().toISOString()
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

    // Test Bearer token validation endpoint
    if (url.pathname === '/api/test-bearer-token' && request.method === 'POST') {
      try {
        const { validateBearerTokenDetailed } = await import('./x-integration.js');
        const result = await validateBearerTokenDetailed(env);
        return new Response(JSON.stringify(result), {
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
    
    // Test and send to Slack API endpoint
    if (url.pathname === '/api/test-send' && request.method === 'POST') {
      try {
        console.log('--- ENTERING /api/test-send ---');
        console.log('env object keys:', Object.keys(env));
        if (env.SLACK_WEBHOOK_URL) {
            console.log('Webhook URL in /api/test-send: SET');
        } else {
            console.log('Webhook URL in /api/test-send: NOT SET');
        }

        const { template } = await request.json();
        const sampleFiling = getSampleFiling();
        
        // Debug: Check if webhook URL is accessible
        console.log('Webhook URL available:', !!env.SLACK_WEBHOOK_URL);
        console.log('Webhook URL value:', env.SLACK_WEBHOOK_URL ? 'SET' : 'NOT SET');
        
        // Create a modified sample filing with [TEST] prefix in the title
        const testFiling = {
          ...sampleFiling,
          title: `[TEST] ${sampleFiling.title}`
        };
        
        // Debug: Try calling sendToSlack the same way as the working endpoint
        console.log('About to call sendToSlack without custom template');
        await sendToSlack([testFiling], env);
        console.log('sendToSlack completed successfully');
        
        // Generate preview with the custom template for display
        const testTemplate = `[TEST] ${template}`;
        const result = applyTemplate(testTemplate, sampleFiling);
        
        return new Response(JSON.stringify({ 
          success: true,
          preview: result,
          message: 'Test message sent to Slack'
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Test-send error:', error.message);
        console.error('Test-send stack:', error.stack);
        return new Response(JSON.stringify({ 
          success: false,
          error: error.message 
        }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Handle manual triggers or testing
    if (request.method === 'POST') {
      const result = await handleScheduled(env);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('FCC Monitor Worker is running', { status: 200 });
  }
};

async function handleScheduled(env) {
  try {
    console.log('--- ENTERING handleScheduled ---');
    console.log('env object keys:', Object.keys(env));
     if (env.SLACK_WEBHOOK_URL) {
        console.log('Webhook URL in handleScheduled: SET');
    } else {
        console.log('Webhook URL in handleScheduled: NOT SET');
    }
    logMessage('Starting FCC monitoring check...');
    
    // First, process any X retry queue items
    try {
      const retryResult = await processRetryQueue(env);
      if (retryResult.processed > 0) {
        logMessage(`Processed ${retryResult.processed} items from X retry queue, ${retryResult.remaining} remaining`);
      }
    } catch (error) {
      logMessage(`Error processing X retry queue: ${error.message}`);
    }
    
    // Throttle logic based on configurable frequency
    const freqStr = await env.FCC_MONITOR_KV.get('monitor_frequency_minutes');
    const frequencyMinutes = freqStr ? parseInt(freqStr, 10) : 60; // default 60 min
    const lastRunStr = await env.FCC_MONITOR_KV.get('last_run_ts');
    const now = Date.now();
    if (lastRunStr && (now - parseInt(lastRunStr, 10)) < frequencyMinutes * 60 * 1000) {
      const minsLeft = Math.ceil((frequencyMinutes * 60 * 1000 - (now - parseInt(lastRunStr, 10))) / 60000);
      logMessage(`Skipping run – next check in ~${minsLeft} minutes (frequency ${frequencyMinutes}m)`);
      return {
        success: true,
        skipped: true,
        message: `Skipped run - next check in ${minsLeft} minutes`,
        frequencyMinutes
      };
    }
    
    // Fetch filings from the last 2 hours for docket 11-42
    const docketNumber = '11-42';
    const allFilings = await fetchECFSFilings(docketNumber, env);
    
    if (allFilings.length > 0) {
      logMessage(`Found ${allFilings.length} filings from API for docket ${docketNumber}`);
      
      // Limit to first 15 filings to avoid KV rate limits
      const filingsToCheck = allFilings.slice(0, 15);
      
      // Filter out filings we've already processed
      // Batch check filing IDs to avoid too many API calls
      const filingIds = filingsToCheck.map(f => f.id);
      const processedChecks = await Promise.all(
        filingIds.map(id => env.FCC_MONITOR_KV.get(`processed_${id}`))
      );
      
      const newFilings = filingsToCheck.filter((filing, index) => !processedChecks[index]);
      
      if (newFilings.length > 0) {
        logMessage(`Found ${newFilings.length} truly new filings to process`);
        
        // Limit to first 10 filings to avoid overwhelming Slack
        const filingsToProcess = newFilings.slice(0, 10);
        
        // Check if X-only mode is enabled
        const xOnlyMode = await env.FCC_MONITOR_KV.get('x_only_mode');
        
        // Parallel posting to Slack and X
        const postingResults = await Promise.allSettled([
          // Send to Slack (unless X-only mode)
          xOnlyMode === 'true' ? 
            Promise.resolve({ success: true, skipped: true, reason: 'X-only mode' }) : 
            sendToSlack(filingsToProcess, env),
          
          // Send to X (if enabled)
          sendToX(filingsToProcess, env)
        ]);
        
        const [slackResult, xResult] = postingResults;
        
        // Log results
        if (slackResult.status === 'fulfilled') {
          if (slackResult.value.skipped) {
            logMessage(`Slack posting: ${slackResult.value.reason || 'skipped'}`);
          } else {
            logMessage('Slack posting: completed successfully');
          }
        } else {
          logMessage(`Slack posting failed: ${slackResult.reason?.message}`);
        }
        
        if (xResult.status === 'fulfilled') {
          const result = xResult.value;
          if (result.skipped) {
            logMessage(`X posting: ${result.reason || 'disabled'}`);
          } else {
            logMessage(`X posting: ${result.posted || 0} posted, ${result.queued || 0} queued`);
          }
        } else {
          logMessage(`X posting failed: ${xResult.reason?.message}`);
        }
        
        // Mark these filings as processed (expire after 7 days) - batch operation
        await Promise.all(
          filingsToProcess.map(filing => 
            env.FCC_MONITOR_KV.put(`processed_${filing.id}`, 'true', {
              expirationTtl: 7 * 24 * 60 * 60 // 7 days in seconds
            })
          )
        );
        
        // Update last run timestamp
        await env.FCC_MONITOR_KV.put('last_run_ts', now.toString());
        
        return {
          success: true,
          message: `Processed ${filingsToProcess.length} new filings (${allFilings.length} total found)`,
          filings: filingsToProcess.slice(0, 3) // Show first 3 in response
        };
      } else {
        logMessage(`All ${allFilings.length} filings have already been processed`);
        // Update last run timestamp even if nothing new
        await env.FCC_MONITOR_KV.put('last_run_ts', now.toString());
        return {
          success: true,
          message: 'No new filings to process (all already sent)',
          filings: []
        };
      }
    } else {
      logMessage(`No filings found for docket ${docketNumber}`);
      // Update last run timestamp when no filings at all
      await env.FCC_MONITOR_KV.put('last_run_ts', now.toString());
      return {
        success: true,
        message: 'No filings found in time range',
        filings: []
      };
    }
  } catch (error) {
    logMessage(`Error in scheduled handler: ${error.message}`);
    logMessage(`Error stack: ${error.stack}`);
    return {
      success: false,
      error: error.message,
      stack: error.stack
    };
  }
} 