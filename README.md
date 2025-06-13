# FCC Monitor Worker

A Cloudflare Worker that monitors FCC ECFS filings for specific dockets.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Get an FCC API key:
   - Visit the [FCC API Portal](https://api.fcc.gov/)
   - Register for an API key
   - Copy your API key

3. Set up environment variables:
```bash
# Set your FCC API key as a secret
wrangler secret put ECFS_API_KEY
```

4. Deploy the worker:
```bash
npm run deploy
```

## Development

To run the worker locally:
```bash
npm run dev
```

## Environment Variables

- `ECFS_API_KEY`: Your FCC API key (set as a secret)
- `ECFS_API_BASE_URL`: Base URL for the FCC API (set in wrangler.toml)

## Monitoring

The worker runs on a schedule to check for new FCC filings. You can monitor the logs in the Cloudflare Workers dashboard. 