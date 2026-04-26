const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Helper: Check if URL is absolute
function isAbsoluteUrl(url) {
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//');
}

// Helper: Make URL absolute from base
function toAbsoluteUrl(url, baseUrl) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('//')) return `https:${url}`;
  
  const baseObj = new URL(baseUrl);
  if (url.startsWith('/')) {
    return `${baseObj.origin}${url}`;
  }
  // Relative path
  const basePath = baseObj.pathname.endsWith('/') ? baseObj.pathname : baseObj.pathname.substring(0, baseObj.pathname.lastIndexOf('/') + 1);
  return `${baseObj.origin}${basePath}${url}`;
}

// Helper: Rewrite HTML content
function rewriteHtml(html, targetUrl, proxyBaseUrl) {
  // Rewrite href attributes in <a> tags
  html = html.replace(/(href)=["']([^"']+)["']/gi, (match, attr, url) => {
    if (url.startsWith('#') || url.startsWith('javascript:') || url.startsWith('data:') || url.startsWith('mailto:')) {
      return match;
    }
    const absoluteUrl = toAbsoluteUrl(url, targetUrl);
    return `${attr}="${proxyBaseUrl}?url=${encodeURIComponent(absoluteUrl)}"`;
  });
  
  // Rewrite src attributes in <img>, <script>, <iframe>
  html = html.replace(/(src)=["']([^"']+)["']/gi, (match, attr, url) => {
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:')) {
      return match;
    }
    const absoluteUrl = toAbsoluteUrl(url, targetUrl);
    return `${attr}="${proxyBaseUrl}?url=${encodeURIComponent(absoluteUrl)}"`;
  });
  
  // Rewrite action attributes in <form>
  html = html.replace(/(action)=["']([^"']+)["']/gi, (match, attr, url) => {
    const absoluteUrl = toAbsoluteUrl(url, targetUrl);
    return `${attr}="${proxyBaseUrl}?url=${encodeURIComponent(absoluteUrl)}"`;
  });
  
  // Rewrite CSS url() references
  html = html.replace(/url\(["']?([^"')]+)["']?\)/gi, (match, url) => {
    const absoluteUrl = toAbsoluteUrl(url, targetUrl);
    return `url("${proxyBaseUrl}?url=${encodeURIComponent(absoluteUrl)}")`;
  });
  
  // Inject a base tag to help relative paths (clever trick!)
  const baseTag = `<base href="${targetUrl}">`;
  html = html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  
  // Add a small script to handle dynamic content loading
  const injectScript = `
  <script>
    (function() {
      // Override fetch and XMLHttpRequest to route through proxy
      const proxyBase = "${proxyBaseUrl}";
      const originalFetch = window.fetch;
      window.fetch = function(url, options) {
        if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
          return originalFetch(proxyBase + '?url=' + encodeURIComponent(url), options);
        }
        return originalFetch(url, options);
      };
      
      // Handle dynamically created elements
      const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
          mutation.addedNodes.forEach(function(node) {
            if (node.nodeType === 1) { // Element node
              if (node.tagName === 'IMG' && node.src && node.src.startsWith('http')) {
                if (!node.src.includes(proxyBase)) {
                  node.src = proxyBase + '?url=' + encodeURIComponent(node.src);
                }
              }
              if (node.tagName === 'IFRAME' && node.src && node.src.startsWith('http')) {
                if (!node.src.includes(proxyBase)) {
                  node.src = proxyBase + '?url=' + encodeURIComponent(node.src);
                }
              }
              if (node.tagName === 'SCRIPT' && node.src && node.src.startsWith('http')) {
                if (!node.src.includes(proxyBase)) {
                  node.src = proxyBase + '?url=' + encodeURIComponent(node.src);
                }
              }
              if (node.tagName === 'LINK' && node.href && node.href.startsWith('http')) {
                if (!node.href.includes(proxyBase)) {
                  node.href = proxyBase + '?url=' + encodeURIComponent(node.href);
                }
              }
            }
          });
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    })();
  </script>
  `;
  
  html = html.replace(/<\/body>/i, `${injectScript}</body>`);
  
  return html;
}

// Main proxy endpoint
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).json({ error: 'No URL provided' });
  }
  
  console.log(`🔄 Proxying: ${targetUrl}`);
  
  try {
    // Fetch the target URL
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': targetUrl
      }
    });
    
    // Get content type
    const contentType = response.headers.get('content-type') || '';
    
    // If it's HTML, rewrite it
    if (contentType.includes('text/html')) {
      let html = await response.text();
      const proxyBaseUrl = `${req.protocol}://${req.get('host')}/proxy`;
      html = rewriteHtml(html, targetUrl, proxyBaseUrl);
      
      // Set permissive headers (THIS IS KEY for iframe bypass!)
      res.setHeader('X-Frame-Options', 'ALLOWALL');
      res.setHeader('Content-Security-Policy', "frame-ancestors *; default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;");
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      
      return res.send(html);
    }
    
    // For non-HTML content (images, CSS, JS), just pass through but add CORS headers
    const buffer = await response.arrayBuffer();
    
    // Remove restrictive headers
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Forward the content type
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    
    res.send(Buffer.from(buffer));
    
  } catch (error) {
    console.error('❌ Proxy error:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch URL', 
      details: error.message,
      url: targetUrl
    });
  }
});

// Handle OPTIONS requests for CORS
app.options('/proxy', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.sendStatus(200);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Fanter Search Recursive Proxy is running!',
    features: ['URL rewriting', 'Header stripping', 'Iframe bypass', 'Dynamic content handling']
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'online', 
    service: 'Fanter Search Recursive Proxy',
    version: '2.0',
    endpoints: {
      proxy: '/proxy?url=YOUR_URL',
      health: '/health'
    },
    usage: 'Use the /proxy endpoint to fetch any website and have it embedded in your iframe'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Fanter Search Recursive Proxy running on port ${PORT}`);
  console.log(`📍 Proxy endpoint: http://localhost:${PORT}/proxy?url=https://example.com`);
});
