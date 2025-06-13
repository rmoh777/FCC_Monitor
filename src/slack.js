import { logMessage } from './utils.js';

// Default template (extracted from current hardcoded format)
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
    .replace(/{filing_type}/g, filing.filing_type || 'Filing')
    .replace(/{title}/g, filing.title || 'Untitled')
    .replace(/{author}/g, filing.author || 'Anonymous')
    .replace(/{date}/g, formatDate(filing.date_received))
    .replace(/{docket}/g, filing.docket_number || '')
    .replace(/{url}/g, filing.filing_url || '');
}

export function getSampleFiling() {
  return {
    id: 'sample123',
    docket_number: '11-42',
    filing_type: 'COMMENT',
    title: 'Sample Public Comment on Lifeline Program',
    author: 'Example Organization',
    date_received: '2025-01-15',
    filing_url: 'https://www.fcc.gov/ecfs/search/search-filings/filing/sample123'
  };
}

export function getDefaultTemplate() {
  return DEFAULT_TEMPLATE;
}

export async function sendToSlack(filings, env, customTemplate = null) {
  const webhookUrl = env.SLACK_WEBHOOK_URL;
  
  if (!webhookUrl) {
    throw new Error('SLACK_WEBHOOK_URL environment variable is not set');
  }

  if (!filings || filings.length === 0) {
    logMessage('No filings to send to Slack');
    return;
  }

  // Get template from KV once for all filings (unless custom template provided)
  const template = customTemplate || await getTemplateFromKV(env);
  
  const blocks = filings.map(filing => {
    // Apply template to filing
    let tweetText = applyTemplate(template, filing);

    // Ensure under 240 characters by truncating if needed
    if (tweetText.length > 240) {
      // Try shortening the title first
      const maxTitleLength = Math.max(15, 50 - (tweetText.length - 240));
      const shortTitle = filing.title.length > maxTitleLength 
        ? filing.title.substring(0, maxTitleLength) + '...'
        : filing.title;
      
      const updatedFiling = { ...filing, title: shortTitle };
      tweetText = applyTemplate(template || DEFAULT_TEMPLATE, updatedFiling);
      
      // If still too long, shorten author name
      if (tweetText.length > 240) {
        const maxAuthorLength = Math.max(15, 40 - (tweetText.length - 240));
        const shortAuthor = filing.author.length > maxAuthorLength
          ? filing.author.substring(0, maxAuthorLength) + '...'
          : filing.author;
        
        const finalFiling = { ...updatedFiling, author: shortAuthor };
        tweetText = applyTemplate(template || DEFAULT_TEMPLATE, finalFiling);
      }
    }

    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `\`\`\`${tweetText}\`\`\``
      }
    };
  });

  const message = {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `📝 New FCC Filings (${filings.length})`,
          emoji: true
        }
      },
      ...blocks
    ]
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      throw new Error(`Slack API returned ${response.status}: ${response.statusText}`);
    }

    logMessage(`Successfully sent ${filings.length} filings to Slack`);
  } catch (error) {
    logMessage(`Error sending to Slack: ${error.message}`);
    throw error;
  }
} 