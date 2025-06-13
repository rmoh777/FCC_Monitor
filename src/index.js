import { fetchECFSFilings } from './ecfs-api.js';
import { sendToSlack } from './slack.js';
import { logMessage } from './utils.js';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(env));
  },

  async fetch(request, env, ctx) {
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