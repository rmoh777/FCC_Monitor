import { logMessage } from './utils.js';
import { applyTemplate } from './slack.js';

// X API Configuration
const X_API_BASE = 'https://api.twitter.com/2';
const RATE_LIMIT = {
  MAX_TWEETS_PER_15MIN: 50, // Conservative limit as requested
  BURST_LIMIT: 5, // Max tweets per batch
  SAFETY_BUFFER: 10 // Reserve calls for manual posts
};

// Default X-specific template (more concise for Twitter)
const DEFAULT_X_TEMPLATE = `🚨 NEW FCC FILING

📋 {filing_type}: {title}
🏢 {author}
📅 {date}
🔗 {url}

#FCC #{docket} #Telecom`;

// === CREDENTIAL ENCRYPTION FUNCTIONS ===

export async function encryptCredentials(credentials, env) {
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
    new TextEncoder().encode(JSON.stringify(credentials))
  );
  
  return JSON.stringify({
    encrypted: Array.from(new Uint8Array(encrypted)),
    iv: Array.from(iv)
  });
}

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
  
  return JSON.parse(new TextDecoder().decode(decrypted));
}

// === OAUTH 1.0A FUNCTIONS ===

function generateNonce() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

async function generateSignature(method, url, params, consumerSecret, tokenSecret) {
  // Sort parameters
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&');
  
  // Create signature base string
  const signatureBaseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(sortedParams)
  ].join('&');
  
  // Create signing key
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  
  // Generate HMAC-SHA1 signature
  const keyData = new TextEncoder().encode(signingKey);
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signatureBaseString)
  );
  
  // Convert to base64
  const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return base64;
}

function generateAuthHeader(credentials, method, url, additionalParams = {}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = generateNonce();
  
  const oauthParams = {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: credentials.accessToken,
    oauth_version: '1.0'
  };
  
  // Combine oauth and additional params for signature
  const allParams = { ...oauthParams, ...additionalParams };
  
  return { oauthParams, allParams, timestamp, nonce };
}

// === RATE LIMITING FUNCTIONS ===

export async function checkRateLimit(env) {
  const remaining = await env.FCC_MONITOR_KV.get('x_rate_limit_remaining');
  const reset = await env.FCC_MONITOR_KV.get('x_rate_limit_reset');
  const now = Date.now();
  
  // If reset time has passed, restore full quota
  if (!reset || now > parseInt(reset)) {
    await env.FCC_MONITOR_KV.put('x_rate_limit_remaining', RATE_LIMIT.MAX_TWEETS_PER_15MIN.toString());
    await env.FCC_MONITOR_KV.put('x_rate_limit_reset', (now + 15 * 60 * 1000).toString());
    return { remaining: RATE_LIMIT.MAX_TWEETS_PER_15MIN, resetTime: now + 15 * 60 * 1000 };
  }
  
  return { 
    remaining: parseInt(remaining || RATE_LIMIT.MAX_TWEETS_PER_15MIN.toString()), 
    resetTime: parseInt(reset) 
  };
}

export async function updateRateLimit(responseHeaders, env) {
  const remaining = responseHeaders.get('x-rate-limit-remaining');
  const reset = responseHeaders.get('x-rate-limit-reset');
  
  if (remaining) {
    await env.FCC_MONITOR_KV.put('x_rate_limit_remaining', remaining);
    logMessage(`Updated X rate limit remaining: ${remaining}`);
  }
  if (reset) {
    await env.FCC_MONITOR_KV.put('x_rate_limit_reset', (parseInt(reset) * 1000).toString());
  }
}

// === RETRY QUEUE FUNCTIONS ===

export async function addToRetryQueue(filing, errorReason, env) {
  try {
    const queueData = await env.FCC_MONITOR_KV.get('x_retry_queue');
    const queue = queueData ? JSON.parse(queueData) : [];
    
    const retryItem = {
      filing,
      attempt_count: 1,
      next_retry_ts: Date.now() + (15 * 60 * 1000), // Retry in 15 minutes
      original_post_time: new Date().toISOString(),
      error_reason: errorReason
    };
    
    queue.push(retryItem);
    
    // Keep only last 50 items to prevent queue from growing too large
    const trimmedQueue = queue.slice(-50);
    
    await env.FCC_MONITOR_KV.put('x_retry_queue', JSON.stringify(trimmedQueue));
    logMessage(`Added filing ${filing.id} to X retry queue: ${errorReason}`);
  } catch (error) {
    logMessage(`Error adding to retry queue: ${error.message}`);
  }
}

export async function processRetryQueue(env) {
  try {
    const queueData = await env.FCC_MONITOR_KV.get('x_retry_queue');
    if (!queueData) return { processed: 0, remaining: 0 };
    
    const queue = JSON.parse(queueData);
    const now = Date.now();
    const readyToRetry = queue.filter(item => now >= item.next_retry_ts);
    const notReady = queue.filter(item => now < item.next_retry_ts);
    
    if (readyToRetry.length === 0) {
      return { processed: 0, remaining: queue.length };
    }
    
    logMessage(`Processing ${readyToRetry.length} items from X retry queue`);
    
    const processed = [];
    const stillFailed = [];
    
    for (const item of readyToRetry) {
      try {
        await postSingleTweet(item.filing, env);
        processed.push(item);
        logMessage(`Successfully retried posting filing ${item.filing.id} to X`);
      } catch (error) {
        // Increase attempt count and schedule for later retry
        item.attempt_count++;
        const retryDelays = [15*60, 60*60, 4*60*60, 24*60*60]; // 15min, 1hr, 4hr, 24hr in seconds
        
        if (item.attempt_count <= retryDelays.length) {
          item.next_retry_ts = now + (retryDelays[item.attempt_count - 1] * 1000);
          item.error_reason = error.message;
          stillFailed.push(item);
          logMessage(`Retry failed for filing ${item.filing.id}, attempt ${item.attempt_count}: ${error.message}`);
        } else {
          logMessage(`Dropping filing ${item.filing.id} from retry queue after ${item.attempt_count} attempts`);
        }
      }
    }
    
    // Update queue with remaining items
    const updatedQueue = [...notReady, ...stillFailed];
    await env.FCC_MONITOR_KV.put('x_retry_queue', JSON.stringify(updatedQueue));
    
    return { processed: processed.length, remaining: updatedQueue.length };
  } catch (error) {
    logMessage(`Error processing retry queue: ${error.message}`);
    return { processed: 0, remaining: 0, error: error.message };
  }
}

// === CORE X POSTING FUNCTIONS ===

export function getDefaultXTemplate() {
  return DEFAULT_X_TEMPLATE;
}

export async function getXTemplateFromKV(env) {
  try {
    const template = await env.FCC_MONITOR_KV.get('x_template');
    return template || DEFAULT_X_TEMPLATE;
  } catch (error) {
    console.error('Error reading X template from KV:', error);
    return DEFAULT_X_TEMPLATE;
  }
}

function formatForX(filing, template) {
  // Apply the template
  let tweetText = applyTemplate(template, filing);
  
  // X-specific formatting: Replace WC docket format with hashtag
  tweetText = tweetText.replace(/WC\s+(\d+-\d+)/g, '#WC$1');
  
  // Ensure under 280 characters (X limit)
  if (tweetText.length > 280) {
    // Try shortening the title first
    const maxTitleLength = Math.max(20, 60 - (tweetText.length - 280));
    const shortTitle = filing.title.length > maxTitleLength 
      ? filing.title.substring(0, maxTitleLength) + '...'
      : filing.title;
    
    const updatedFiling = { ...filing, title: shortTitle };
    tweetText = applyTemplate(template, updatedFiling);
    
    // If still too long, shorten author name
    if (tweetText.length > 280) {
      const maxAuthorLength = Math.max(15, 30 - (tweetText.length - 280));
      const shortAuthor = filing.author.length > maxAuthorLength
        ? filing.author.substring(0, maxAuthorLength) + '...'
        : filing.author;
      
      const finalFiling = { ...updatedFiling, author: shortAuthor };
      tweetText = applyTemplate(template, finalFiling);
      
      // Final fallback: hard truncate with ellipsis
      if (tweetText.length > 280) {
        tweetText = tweetText.substring(0, 277) + '...';
      }
    }
  }
  
  return tweetText;
}

async function postSingleTweet(filing, env, customTemplate = null) {
  const encryptedCreds = await env.FCC_MONITOR_KV.get('x_credentials');
  if (!encryptedCreds) {
    throw new Error('X credentials not configured');
  }

  const credentials = await decryptCredentials(encryptedCreds, env);
  const template = customTemplate || await getXTemplateFromKV(env);
  
  const tweetText = formatForX(filing, template);
  
  logMessage(`Posting to X: ${tweetText.substring(0, 50)}...`);

  const url = `${X_API_BASE}/tweets`;
  const method = 'POST';
  
  // Generate OAuth 1.0a authentication
  const { oauthParams, allParams } = generateAuthHeader(credentials, method, url);
  
  // Generate signature
  const signature = await generateSignature(method, url, allParams, credentials.apiSecret, credentials.accessTokenSecret);
  
  // Build Authorization header
  const authParams = {
    ...oauthParams,
    oauth_signature: signature
  };
  
  const authHeader = 'OAuth ' + Object.keys(authParams)
    .sort()
    .map(key => `${percentEncode(key)}="${percentEncode(authParams[key])}"`)
    .join(', ');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: tweetText
    })
  });

  // Update rate limits from response headers
  await updateRateLimit(response.headers, env);

  if (!response.ok) {
    const error = await response.text();
    
    // Handle specific error cases
    if (response.status === 401) {
      throw new Error('X API authentication failed - check your API keys and tokens');
    } else if (response.status === 403) {
      throw new Error('X API forbidden - check your app permissions and authentication');
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

export async function sendToX(filings, env, customTemplate = null) {
  try {
    const xEnabled = await env.FCC_MONITOR_KV.get('x_posting_enabled');
    if (xEnabled !== 'true') {
      logMessage('X posting disabled, skipping');
      return { success: true, skipped: true };
    }

    if (!filings || filings.length === 0) {
      logMessage('No filings to send to X');
      return { success: true, posted: 0 };
    }

    // Check if credentials are configured
    const encryptedCreds = await env.FCC_MONITOR_KV.get('x_credentials');
    if (!encryptedCreds) {
      logMessage('X credentials not configured, skipping X posting');
      return { success: true, skipped: true, reason: 'No credentials' };
    }

    // Check rate limits
    const rateLimit = await checkRateLimit(env);
    const maxPosts = Math.min(
      RATE_LIMIT.BURST_LIMIT, 
      rateLimit.remaining - RATE_LIMIT.SAFETY_BUFFER, 
      filings.length
    );
    
    if (maxPosts <= 0) {
      logMessage('X rate limit exceeded, adding all filings to retry queue');
      await Promise.all(filings.map(f => addToRetryQueue(f, 'rate_limit_exceeded', env)));
      return { success: true, queued: filings.length };
    }

    const filingsToPost = filings.slice(0, maxPosts);
    const filingsToQueue = filings.slice(maxPosts);

    logMessage(`Posting ${filingsToPost.length} filings to X, queueing ${filingsToQueue.length}`);

    const results = [];

    // Post tweets with delays to avoid hitting rate limits
    for (let i = 0; i < filingsToPost.length; i++) {
      if (i > 0) {
        // 3 second delay between posts to be respectful
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      try {
        const result = await postSingleTweet(filingsToPost[i], env, customTemplate);
        results.push({ filing: filingsToPost[i], success: true, tweetId: result.data?.id });
        
        // Update remaining rate limit count
        const currentRemaining = await env.FCC_MONITOR_KV.get('x_rate_limit_remaining');
        if (currentRemaining) {
          const newRemaining = Math.max(0, parseInt(currentRemaining) - 1);
          await env.FCC_MONITOR_KV.put('x_rate_limit_remaining', newRemaining.toString());
        }
        
      } catch (error) {
        logMessage(`Failed to post filing ${filingsToPost[i].id} to X: ${error.message}`);
        await addToRetryQueue(filingsToPost[i], error.message, env);
        results.push({ filing: filingsToPost[i], success: false, error: error.message });
      }
    }

    // Queue remaining filings for later processing
    if (filingsToQueue.length > 0) {
      await Promise.all(filingsToQueue.map(f => addToRetryQueue(f, 'batch_limit_exceeded', env)));
    }

    const successCount = results.filter(r => r.success).length;
    logMessage(`X posting complete: ${successCount} posted, ${filingsToQueue.length} queued`);

    return { 
      success: true, 
      posted: successCount, 
      failed: results.length - successCount,
      queued: filingsToQueue.length,
      results 
    };
    
  } catch (error) {
    logMessage(`Error in sendToX: ${error.message}`);
    
    // If there's a general error, try to queue all filings for retry
    if (filings && filings.length > 0) {
      await Promise.all(filings.map(f => addToRetryQueue(f, error.message, env)));
    }
    
    return { success: false, error: error.message, queued: filings?.length || 0 };
  }
}

// === TEST FUNCTION ===

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
      message: 'Test tweet posted successfully',
      preview: formatForX(sampleFiling, customTemplate || await getXTemplateFromKV(env))
    };
  } catch (error) {
    return { 
      success: false, 
      error: error.message,
      preview: formatForX(sampleFiling, customTemplate || await getXTemplateFromKV(env))
    };
  }
} 