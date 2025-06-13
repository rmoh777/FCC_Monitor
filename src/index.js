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
          const xTemplate = await env.FCC_MONITOR_KV.get('x_template');
          const xOnlyMode = await env.FCC_MONITOR_KV.get('x_only_mode');
          
          return new Response(JSON.stringify({ 
            template: template || getDefaultTemplate(),
            frequency,
            xEnabled: xEnabled === 'true',
            xCredentialsSet,
            xTemplate: xTemplate || getDefaultXTemplate(),
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
          const { template, frequency, xEnabled, xCredentials, xTemplate, xOnlyMode } = await request.json();

          if (template !== undefined) {
            await env.FCC_MONITOR_KV.put('dashboard_template', template);
          }

          if (frequency !== undefined) {
            await env.FCC_MONITOR_KV.put('monitor_frequency_minutes', frequency.toString());
          }
          
          // X Configuration
          if (xEnabled !== undefined) {
            await env.FCC_MONITOR_KV.put('x_posting_enabled', xEnabled.toString());
          }
          
          if (xCredentials) {
            // Encrypt and store X credentials
            const encrypted = await encryptCredentials(xCredentials, env);
            await env.FCC_MONITOR_KV.put('x_credentials', encrypted);
          }
          
          if (xTemplate !== undefined) {
            await env.FCC_MONITOR_KV.put('x_template', xTemplate);
          }
          
          if (xOnlyMode !== undefined) {
            await env.FCC_MONITOR_KV.put('x_only_mode', xOnlyMode.toString());
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
        const { template } = await request.json();
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