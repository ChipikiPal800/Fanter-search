const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).json({ error: 'No URL provided' });
  }
  
  try {
    const response = await fetch(targetUrl);
    const data = await response.text();
    const baseUrl = targetUrl.match(/^https?:\/\/[^\/]+/)[0];
    const fixedData = data.replace(/(href|src)=["']\/(?!\/)/g, `$1="${baseUrl}/`);
    res.set('Content-Type', response.headers.get('content-type'));
    res.send(fixedData);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch URL' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Proxy running on port ${PORT}`));
