import { logMessage } from './utils.js';

export async function sendToSlack(filings, env) {
  const webhookUrl = env.SLACK_WEBHOOK_URL;
  
  if (!webhookUrl) {
    throw new Error('SLACK_WEBHOOK_URL environment variable is not set');
  }

  if (!filings || filings.length === 0) {
    logMessage('No filings to send to Slack');
    return;
  }

  const blocks = filings.map(filing => {
    // Format date as MM/DD/YY
    const formatDate = (dateStr) => {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { 
        month: '2-digit', 
        day: '2-digit', 
        year: '2-digit' 
      });
    };

    // Create X.com-ready message (under 240 chars)
    let tweetText = `🚨 NEW FCC FILING

📋 ${filing.filing_type}: ${filing.title}
🏢 ${filing.author}
📅 ${formatDate(filing.date_received)}
🔗 WC ${filing.docket_number}

${filing.filing_url}

#Lifeline #FCC`;

    // Ensure under 240 characters by truncating if needed
    if (tweetText.length > 240) {
      // Try shortening the title first
      const maxTitleLength = Math.max(15, 50 - (tweetText.length - 240));
      const shortTitle = filing.title.length > maxTitleLength 
        ? filing.title.substring(0, maxTitleLength) + '...'
        : filing.title;
      
      tweetText = `🚨 NEW FCC FILING

📋 ${filing.filing_type}: ${shortTitle}
🏢 ${filing.author}
📅 ${formatDate(filing.date_received)}
🔗 WC ${filing.docket_number}

${filing.filing_url}

#Lifeline #FCC`;
      
      // If still too long, shorten author name
      if (tweetText.length > 240) {
        const maxAuthorLength = Math.max(15, 40 - (tweetText.length - 240));
        const shortAuthor = filing.author.length > maxAuthorLength
          ? filing.author.substring(0, maxAuthorLength) + '...'
          : filing.author;
        
        tweetText = `🚨 NEW FCC FILING

📋 ${filing.filing_type}: ${shortTitle}
🏢 ${shortAuthor}
📅 ${formatDate(filing.date_received)}
🔗 WC ${filing.docket_number}

${filing.filing_url}

#Lifeline #FCC`;
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