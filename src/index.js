import { fetchECFSFilings } from './ecfs-api.js';
import { sendToSlack } from './slack.js';
import { logMessage } from './utils.js';
import { getDashboardHTML } from './dashboard.js';
import { getDefaultTemplate, applyTemplate, getSampleFiling } from './slack.js';

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
          return new Response(JSON.stringify({ 
            template: template || getDefaultTemplate() 
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
          const { template } = await request.json();
          await env.FCC_MONITOR_KV.put('dashboard_template', template);
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
        
        // Send to Slack
        await sendToSlack(filingsToProcess, env);
        
        // Mark these filings as processed (expire after 7 days) - batch operation
        await Promise.all(
          filingsToProcess.map(filing => 
            env.FCC_MONITOR_KV.put(`processed_${filing.id}`, 'true', {
              expirationTtl: 7 * 24 * 60 * 60 // 7 days in seconds
            })
          )
        );
        
        return {
          success: true,
          message: `Processed ${filingsToProcess.length} new filings (${allFilings.length} total found)`,
          filings: filingsToProcess.slice(0, 3) // Show first 3 in response
        };
      } else {
        logMessage(`All ${allFilings.length} filings have already been processed`);
        return {
          success: true,
          message: 'No new filings to process (all already sent)',
          filings: []
        };
      }
    } else {
      logMessage(`No filings found for docket ${docketNumber}`);
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