const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Simple proxy endpoint
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).json({ error: 'No URL provided' });
  }
  
  try {
    // Use fetch (built into Node 18+)
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const data = await response.text();
    
    // Fix relative links
    const baseUrl = targetUrl.match(/^https?:\/\/[^\/]+/)[0];
    const fixedData = data.replace(/(href|src)=["']\/(?!\/)/g, `$1="${baseUrl}/`);
    
    res.set('Content-Type', response.headers.get('content-type') || 'text/html');
    res.send(fixedData);
  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(500).json({ error: 'Failed to fetch URL: ' + error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Fanter Search Proxy is running!' });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'online', 
    service: 'Fanter Search Proxy',
    endpoints: {
      proxy: '/proxy?url=YOUR_URL',
      health: '/health'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Fanter Search Proxy running on port ${PORT}`);
});
