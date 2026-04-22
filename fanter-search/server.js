const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const url = require('url');

const app = express();

app.use(cors());
app.use(express.json());

// Helper function to fetch URLs (works without node-fetch)
function fetchUrl(targetUrl) {
  return new Promise((resolve, reject) => {
    const parsedUrl = url.parse(targetUrl);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.path,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };
    
    const req = protocol.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, data, headers: res.headers }));
    });
    
    req.on('error', reject);
    req.end();
  });
}

// Main proxy endpoint
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).json({ error: 'No URL provided' });
  }
  
  try {
    const result = await fetchUrl(targetUrl);
    
    if (result.statusCode !== 200) {
      return res.status(result.statusCode).json({ error: 'Failed to fetch URL' });
    }
    
    // Fix relative links
    const baseUrl = targetUrl.match(/^https?:\/\/[^\/]+/)[0];
    let fixedData = result.data.replace(/(href|src)=["']\/(?!\/)/g, `$1="${baseUrl}/`);
    
    res.set('Content-Type', result.headers['content-type'] || 'text/html');
    res.send(fixedData);
  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(500).json({ error: 'Failed to fetch URL: ' + error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Fanter Search Proxy running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`📍 Proxy endpoint: http://localhost:${PORT}/proxy?url=https://example.com`);
});
