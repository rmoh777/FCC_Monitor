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

export function getDefaultXTemplate() {
  return DEFAULT_X_TEMPLATE;
}

export async function getXTemplateFromKV(env) {
  const template = await env.FCC_MONITOR_KV.get('dashboard_template');
  return template || DEFAULT_X_TEMPLATE;
}

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
    new TextEncoder().encode(JSON.stringify(credentials)) // OAuth 2.0 credentials object
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
  
  return JSON.parse(new TextDecoder().decode(decrypted)); // Return parsed credentials object
}

// === OAUTH 2.0 AUTHORIZATION CODE FLOW ===

export function generateAuthorizationUrl(clientId) {
  const baseUrl = 'https://twitter.com/i/oauth2/authorize';
  const redirectUri = 'https://fcc-monitor.fcc-monitor-11-42.workers.dev/api/oauth/callback';
  const scopes = 'tweet.read tweet.write users.read';
  const state = Math.random().toString(36).substring(2, 15);
  
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    state: state,
    code_challenge: 'challenge', // PKCE - using static for simplicity
    code_challenge_method: 'plain'
  });
  
  return `${baseUrl}?${params.toString()}`;
}

export async function exchangeCodeForToken(authCode, env) {
  try {
    const encryptedCreds = await env.FCC_MONITOR_KV.get('x_credentials');
    if (!encryptedCreds) {
      throw new Error('OAuth 2.0 credentials not configured');
    }

    const credentials = await decryptCredentials(encryptedCreds, env);
    const redirectUri = 'https://fcc-monitor.fcc-monitor-11-42.workers.dev/api/oauth/callback';
    
    const response = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: redirectUri,
        code_verifier: 'challenge'
      }).toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    const tokenData = await response.json();
    logMessage(`Successfully obtained OAuth 2.0 access token via authorization code`);
    
    // Store the access token (and refresh token if provided)
    const tokenInfo = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + (tokenData.expires_in * 1000) - 60000, // 1 minute buffer
      token_type: tokenData.token_type
    };
    
    await env.FCC_MONITOR_KV.put('x_oauth_token', JSON.stringify(tokenInfo), {
      expirationTtl: tokenData.expires_in - 60
    });

    return tokenInfo;
  } catch (error) {
    logMessage(`OAuth 2.0 code exchange failed: ${error.message}`);
    throw error;
  }
}

export async function getCachedOrNewAccessToken(env) {
  try {
    // Check for cached access token first
    const cachedToken = await env.FCC_MONITOR_KV.get('x_oauth_token');
    if (cachedToken) {
      try {
        const tokenData = JSON.parse(cachedToken);
        
        // Check if token is still valid (with 5-minute buffer)
        const expiresAt = tokenData.expires_at;
        const now = Date.now();
        const bufferTime = 5 * 60 * 1000; // 5 minutes
        
        if (expiresAt && now < (expiresAt - bufferTime)) {
          logMessage(`Using cached OAuth 2.0 access token (expires in ${Math.round((expiresAt - now) / 60000)} minutes)`);
          return tokenData.access_token;
        }
        
        // Token expired or expiring soon, try to refresh
        if (tokenData.refresh_token) {
          logMessage(`Access token expired/expiring, attempting refresh...`);
          try {
            const newAccessToken = await refreshAccessToken(tokenData.refresh_token, env);
            return newAccessToken;
          } catch (refreshError) {
            logMessage(`Token refresh failed: ${refreshError.message}`);
            // Fall through to get new token
          }
        }
      } catch (parseError) {
        logMessage(`Failed to parse cached token: ${parseError.message}`);
      }
    }

    // No valid cached token, need to get credentials and generate new token
    const encryptedCreds = await env.FCC_MONITOR_KV.get('x_credentials');
    if (!encryptedCreds) {
      throw new Error('OAuth 2.0 credentials not configured');
    }

    const credentials = await decryptCredentials(encryptedCreds, env);
    
    // Add rate limit check before making OAuth calls
    const lastOAuthCall = await env.FCC_MONITOR_KV.get('x_last_oauth_call');
    const now = Date.now();
    if (lastOAuthCall) {
      const timeSinceLastCall = now - parseInt(lastOAuthCall);
      const minInterval = 2000; // 2 seconds minimum between OAuth calls
      if (timeSinceLastCall < minInterval) {
        const waitTime = minInterval - timeSinceLastCall;
        logMessage(`Rate limiting OAuth calls, waiting ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    // Record this OAuth call
    await env.FCC_MONITOR_KV.put('x_last_oauth_call', now.toString());
    
    return await getOAuth2AccessToken(credentials, env);
    
  } catch (error) {
    logMessage(`Failed to get OAuth 2.0 access token: ${error.message}`);
    throw error;
  }
}

export async function refreshAccessToken(refreshToken, env) {
  try {
    const encryptedCreds = await env.FCC_MONITOR_KV.get('x_credentials');
    if (!encryptedCreds) {
      throw new Error('OAuth 2.0 credentials not configured');
    }

    const credentials = await decryptCredentials(encryptedCreds, env);
    
    const response = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }).toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
    }

    const tokenData = await response.json();
    logMessage(`Successfully refreshed OAuth 2.0 access token`);
    
    // Store the new access token
    const tokenInfo = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || refreshToken, // Keep old refresh token if new one not provided
      expires_at: Date.now() + (tokenData.expires_in * 1000) - 60000, // 1 minute buffer
      token_type: tokenData.token_type
    };
    
    await env.FCC_MONITOR_KV.put('x_oauth_token', JSON.stringify(tokenInfo), {
      expirationTtl: tokenData.expires_in - 60
    });

    return tokenInfo.access_token;
  } catch (error) {
    logMessage(`OAuth 2.0 token refresh failed: ${error.message}`);
    throw error;
  }
}

export async function validateBearerToken(token, env) {
  try {
    const response = await fetch('https://api.twitter.com/2/users/me', {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    return response.ok;
  } catch (error) {
    logMessage(`Bearer token validation failed: ${error.message}`);
    return false;
  }
}

// Lightweight OAuth 2.0 validation - NEW (no test tweets)
export async function validateOAuth2Lightweight(env) {
  try {
    const encryptedCreds = await env.FCC_MONITOR_KV.get('x_credentials');
    if (!encryptedCreds) {
      return {
        success: false,
        error: 'No OAuth 2.0 credentials found in storage',
        details: 'Please save your Client ID and Client Secret first'
      };
    }

    const credentials = await decryptCredentials(encryptedCreds, env);
    
    // Validate credential format
    if (!credentials.clientId || !credentials.clientSecret) {
      return {
        success: false,
        error: 'Invalid OAuth 2.0 credentials format',
        details: 'Missing Client ID or Client Secret'
      };
    }

    logMessage(`Testing OAuth 2.0 credentials (lightweight): ${credentials.clientId}...`);

    // Try to get an access token (this validates credentials)
    try {
      const accessToken = await getCachedOrNewAccessToken(env);
      
      if (!accessToken) {
        return {
          success: false,
          error: 'Failed to obtain access token',
          details: 'Could not get valid access token with provided credentials',
          clientId: credentials.clientId
        };
      }

      // Test with a simple read-only API call (no posting)
      const response = await fetch('https://api.twitter.com/2/users/me', {
        headers: { 
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const responseText = await response.text();
      logMessage(`X API lightweight validation response: ${response.status} ${response.statusText}`);

      if (response.ok) {
        const userData = JSON.parse(responseText);
        return {
          success: true,
          message: 'OAuth 2.0 credentials are valid and working',
          details: `Successfully authenticated as @${userData.data?.username || 'unknown'} with Client ID: ${credentials.clientId}`,
          clientId: credentials.clientId,
          username: userData.data?.username
        };
      } else {
        let errorDetails = 'Unknown error';
        try {
          const errorData = JSON.parse(responseText);
          errorDetails = errorData.detail || errorData.title || errorData.errors?.[0]?.message || responseText;
        } catch (e) {
          errorDetails = responseText || `HTTP ${response.status}`;
        }

        return {
          success: false,
          error: `X API error: ${response.status} ${response.statusText}`,
          details: errorDetails,
          clientId: credentials.clientId,
          httpStatus: response.status
        };
      }
    } catch (tokenError) {
      return {
        success: false,
        error: 'Failed to get OAuth 2.0 access token',
        details: tokenError.message,
        clientId: credentials.clientId
      };
    }
  } catch (error) {
    logMessage(`OAuth 2.0 lightweight validation error: ${error.message}`);
    return {
      success: false,
      error: 'OAuth 2.0 validation failed',
      details: error.message
    };
  }
}

export async function validateBearerTokenDetailed(env) {
  try {
    // First try lightweight validation (no test tweets)
    const lightweightResult = await validateOAuth2Lightweight(env);
    
    // If lightweight validation succeeds, return that result
    // This avoids the expensive test tweet posting
    if (lightweightResult.success) {
      return {
        ...lightweightResult,
        message: 'OAuth 2.0 credentials validated (lightweight check - no test tweet posted)'
      };
    }
    
    // Only fall back to full validation if lightweight fails
    // This preserves the original behavior for edge cases
    logMessage('Lightweight validation failed, attempting full validation with test tweet...');
    
    const encryptedCreds = await env.FCC_MONITOR_KV.get('x_credentials');
    if (!encryptedCreds) {
      return {
        success: false,
        error: 'No OAuth 2.0 credentials found in storage',
        details: 'Please save your Client ID and Client Secret first'
      };
    }

    const credentials = await decryptCredentials(encryptedCreds, env);
    
    // Validate credential format
    if (!credentials.clientId || !credentials.clientSecret) {
      return {
        success: false,
        error: 'Invalid OAuth 2.0 credentials format',
        details: 'Missing Client ID or Client Secret'
      };
    }

    logMessage(`Testing OAuth 2.0 credentials (full validation): ${credentials.clientId}...`);

    // Try to get an access token
    try {
      const accessToken = await getCachedOrNewAccessToken(env);
      
      // Test the access token with a simple API call
      const response = await fetch('https://api.twitter.com/2/tweets', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: '[TEST] OAuth 2.0 validation test - please ignore'
        })
      });

      const responseText = await response.text();
      logMessage(`X API validation response: ${response.status} ${response.statusText}`);
      logMessage(`X API response body: ${responseText}`);

      if (response.ok) {
        // Delete the test tweet if it was posted
        const result = JSON.parse(responseText);
        if (result.data?.id) {
          // Attempt to delete the test tweet
          await fetch(`https://api.twitter.com/2/tweets/${result.data.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${accessToken}` }
          }).catch(() => {}); // Ignore delete errors
        }

        return {
          success: true,
          message: 'OAuth 2.0 credentials are valid and working (full validation with test tweet)',
          details: `Successfully authenticated with Client ID: ${credentials.clientId}`,
          clientId: credentials.clientId
        };
      } else {
        let errorDetails = 'Unknown error';
        try {
          const errorData = JSON.parse(responseText);
          errorDetails = errorData.detail || errorData.title || errorData.errors?.[0]?.message || responseText;
        } catch (e) {
          errorDetails = responseText || `HTTP ${response.status}`;
        }

        return {
          success: false,
          error: `X API error: ${response.status} ${response.statusText}`,
          details: errorDetails,
          clientId: credentials.clientId,
          httpStatus: response.status
        };
      }
    } catch (tokenError) {
      return {
        success: false,
        error: 'Failed to get OAuth 2.0 access token',
        details: tokenError.message,
        clientId: credentials.clientId
      };
    }
  } catch (error) {
    logMessage(`OAuth 2.0 validation error: ${error.message}`);
    return {
      success: false,
      error: 'OAuth 2.0 validation failed',
      details: error.message
    };
  }
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
  try {
    console.log(`[${new Date().toISOString()}] Posting to X: ${formatForX(filing, customTemplate || await getXTemplateFromKV(env)).substring(0, 50)}...`);
    
    const accessToken = await getCachedOrNewAccessToken(env);
    if (!accessToken) {
      throw new Error('No valid access token available');
    }

    const response = await fetch('https://api.twitter.com/2/tweets', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: formatForX(filing, customTemplate || await getXTemplateFromKV(env))
      })
    });

    // Enhanced error logging
    if (!response.ok) {
      const errorBody = await response.text();
      const errorDetails = {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: errorBody
      };
      
      console.error(`[${new Date().toISOString()}] X API Error Details:`, JSON.stringify(errorDetails, null, 2));
      
      if (response.status === 403) {
        throw new Error(`X API forbidden - check your app permissions for posting tweets. Full error: ${errorBody}`);
      } else if (response.status === 401) {
        throw new Error(`X API unauthorized - token may be invalid or expired. Full error: ${errorBody}`);
      } else {
        throw new Error(`X API error (${response.status}): ${errorBody}`);
      }
    }

    const result = await response.json();
    console.log(`[${new Date().toISOString()}] Successfully posted tweet:`, result.data?.id);

    // Update rate limit info
    const remaining = response.headers.get('x-rate-limit-remaining');
    if (remaining) {
      console.log(`[${new Date().toISOString()}] Updated X rate limit remaining: ${remaining}`);
    }

    return result;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error posting to X:`, error.message);
    throw error;
  }
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
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const sampleFiling = {
    id: `test-${timestamp}`,
    docket_number: '11-42',
    filing_type: 'TEST',
    title: `[TEST] Sample FCC Filing for X Integration ${timestamp}`,
    author: 'FCC Monitor Test System',
    date_received: new Date().toISOString().split('T')[0],
    filing_url: `https://www.fcc.gov/ecfs/search/search-filings/filing/test-${timestamp}`
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