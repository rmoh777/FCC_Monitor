import { subHours } from 'date-fns';
import { logMessage } from './utils.js';

export async function fetchECFSFilings(docketNumber, env) {
  const apiKey = env.ECFS_API_KEY;
  const baseUrl = env.ECFS_API_BASE_URL;

  // Validate required environment variables
  if (!apiKey) {
    throw new Error('ECFS_API_KEY environment variable is not set');
  }
  if (!baseUrl) {
    throw new Error('ECFS_API_BASE_URL environment variable is not set');
  }

  // Look for filings from the last 2 hours (to account for any processing delays)
  const sinceDate = subHours(new Date(), 2).toISOString().split('T')[0];
  const url = `${baseUrl}/filings?api_key=${apiKey}&proceedings.name=${docketNumber}&sort=date_disseminated,DESC&per_page=20&received_from=${sinceDate}`;
  try {
    logMessage(`Fetching ECFS filings from: ${url.replace(apiKey, '[API_KEY]')}`);
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'FCC-Monitor-Worker/1.0'
      }
    });
    if (!response.ok) {
      throw new Error(`ECFS API returned ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    
    // Check for the correct property name - API returns 'filing' not 'filings'
    const filings = data.filing || data.filings || [];
    
    if (!filings || filings.length === 0) {
      logMessage('No filings found in API response');
      return [];
    }
    
    logMessage(`API returned ${filings.length} filings for docket ${docketNumber}.`);
    
    // Since we already filtered by proceedings.name in the API query, 
    // we don't need to filter again - all results should be for our docket
    if (filings.length > 0) {
      logMessage(`First filing: ${JSON.stringify(filings[0], null, 2).substring(0, 500)}...`);
    }
    
    return filings.map(filing => parseECFSFiling(filing));
  } catch (error) {
    logMessage(`Error fetching ECFS filings: ${error.message}`);
    throw error;
  }
}

function parseECFSFiling(filing) {
  // Extract author name from the complex structure
  let author = 'Anonymous';
  if (filing.name_of_filer) {
    author = filing.name_of_filer;
  } else if (filing.filers && Array.isArray(filing.filers) && filing.filers.length > 0) {
    author = filing.filers[0].name || 'Anonymous';
  } else if (filing.lawfirms && Array.isArray(filing.lawfirms) && filing.lawfirms.length > 0) {
    author = filing.lawfirms[0].name || 'Anonymous';
  }

  // Clean up document title from filename
  let cleanTitle = filing.submissiontype?.description || 'Filing';
  if (filing.documents && filing.documents.length > 0 && filing.documents[0].filename) {
    let filename = filing.documents[0].filename;
    // Remove file extension and clean up
    cleanTitle = filename
      .replace(/\.pdf$/i, '')
      .replace(/\([^)]*\)/g, '') // Remove parentheses and contents
      .replace(/\d{1,2}\.\d{1,2}\.\d{2,4}/g, '') // Remove dates
      .replace(/\s+/g, ' ')
      .trim();
    
    // If still too long, use submission type
    if (cleanTitle.length > 30) {
      cleanTitle = filing.submissiontype?.description || 'Filing';
    }
  }

  // Shorten company names
  const shortenCompanyName = (name) => {
    return name
      .replace(/\b(Inc\.|Incorporated|LLC|Corporation|Corp\.|Company|Co\.)\b/gi, '')
      .replace(/\bd\/b\/a\s+/gi, '/')
      .replace(/\s+/g, ' ')
      .trim();
  };

  return {
    id: filing.id_submission,
    docket_number: '11-42',
    filing_type: filing.submissiontype?.description || 'FILING',
    title: cleanTitle,
    author: shortenCompanyName(author),
    date_received: filing.date_received,
    filing_url: `https://www.fcc.gov/ecfs/search/search-filings/filing/${filing.id_submission}`,
    summary: filing.brief_comment_summary || filing.text_data?.substring(0, 200) || '',
    processed_at: new Date().toISOString()
  };
} 