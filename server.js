const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Helper: Convert relative URLs to absolute
function toAbsoluteUrl(url, baseUrl) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  
  try {
    const base = new URL(baseUrl);
    if (url.startsWith('/')) {
      return `${base.origin}${url}`;
    }
    // Handle relative paths
    const basePath = base.pathname.endsWith('/') ? base.pathname : base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
    return `${base.origin}${basePath}${url}`;
  } catch(e) {
    return url;
  }
}

// Rewrite HTML content completely
function rewriteHtml(html, targetUrl, proxyBaseUrl) {
  // 1. Rewrite <link href>
  html = html.replace(/<link([^>]*?)href=["']([^"']+)["']([^>]*)>/gi, (match, before, url, after) => {
    if (url.includes('data:') || url.includes('blob:')) return match;
    const absoluteUrl = toAbsoluteUrl(url, targetUrl);
    return `<link${before}href="${proxyBaseUrl}?url=${encodeURIComponent(absoluteUrl)}"${after}>`;
  });
  
  // 2. Rewrite <script src>
  html = html.replace(/<script([^>]*?)src=["']([^"']+)["']([^>]*)>/gi, (match, before, url, after) => {
    const absoluteUrl = toAbsoluteUrl(url, targetUrl);
    return `<script${before}src="${proxyBaseUrl}?url=${encodeURIComponent(absoluteUrl)}"${after}>`;
  });
  
  // 3. Rewrite <img src>
  html = html.replace(/<img([^>]*?)src=["']([^"']+)["']([^>]*)>/gi, (match, before, url, after) => {
    const absoluteUrl = toAbsoluteUrl(url, targetUrl);
    return `<img${before}src="${proxyBaseUrl}?url=${encodeURIComponent(absoluteUrl)}"${after}>`;
  });
  
  // 4. Rewrite <a href>
  html = html.replace(/<a([^>]*?)href=["']([^"']+)["']([^>]*)>/gi, (match, before, url, after) => {
    if (url.startsWith('#') || url.startsWith('javascript:')) return match;
    const absoluteUrl = toAbsoluteUrl(url, targetUrl);
    return `<a${before}href="${proxyBaseUrl}?url=${encodeURIComponent(absoluteUrl)}"${after}>`;
  });
  
  // 5. Rewrite <form action>
  html = html.replace(/<form([^>]*?)action=["']([^"']+)["']([^>]*)>/gi, (match, before, url, after) => {
    const absoluteUrl = toAbsoluteUrl(url, targetUrl);
    return `<form${before}action="${proxyBaseUrl}?url=${encodeURIComponent(absoluteUrl)}"${after}>`;
  });
  
  // 6. Rewrite CSS background-image: url(...)
  html = html.replace(/background(?:-image)?\s*:\s*url\(["']?([^"')]+)["']?\)/gi, (match, url) => {
    if (url.startsWith('data:')) return match;
    const absoluteUrl = toAbsoluteUrl(url, targetUrl);
    return `background: url("${proxyBaseUrl}?url=${encodeURIComponent(absoluteUrl)}")`;
  });
  
  // 7. Rewrite CSS @import url(...)
  html = html.replace(/@import\s*url\(["']?([^"')]+)["']?\)/gi, (match, url) => {
    const absoluteUrl = toAbsoluteUrl(url, targetUrl);
    return `@import url("${proxyBaseUrl}?url=${encodeURIComponent(absoluteUrl)}")`;
  });
  
  // 8. Rewrite srcset attributes
  html = html.replace(/srcset=["']([^"']+)["']/gi, (match, urls) => {
    const newUrls = urls.split(',').map(part => {
      const [url, size] = part.trim().split(/\s+/);
      const absoluteUrl = toAbsoluteUrl(url, targetUrl);
      return `${proxyBaseUrl}?url=${encodeURIComponent(absoluteUrl)}${size ? ' ' + size : ''}`;
    }).join(', ');
    return `srcset="${newUrls}"`;
  });
  
  // 9. Add base tag for relative URLs (fallback)
  const baseTag = `<base href="${proxyBaseUrl}?url=${encodeURIComponent(targetUrl)}/">`;
  html = html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  
  // 10. Inject client-side fixer for dynamically added elements
  const injectScript = `
  <script>
    (function() {
      const proxyBase = "${proxyBaseUrl}";
      const targetOrigin = "${targetUrl}";
      
      function fixUrl(url) {
        if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:')) return url;
        if (url.startsWith(proxyBase)) return url;
        return proxyBase + '?url=' + encodeURIComponent(url);
      }
      
      // Fix existing elements
      document.querySelectorAll('link[href]').forEach(el => {
        if (el.href && !el.href.includes(proxyBase)) {
          el.href = fixUrl(el.href);
        }
      });
      document.querySelectorAll('script[src]').forEach(el => {
        if (el.src && !el.src.includes(proxyBase)) {
          el.src = fixUrl(el.src);
        }
      });
      document.querySelectorAll('img[src]').forEach(el => {
        if (el.src && !el.src.includes(proxyBase)) {
          el.src = fixUrl(el.src);
        }
      });
      
      // Watch for new elements
      const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) {
              if (node.tagName === 'LINK' && node.href) node.href = fixUrl(node.href);
              if (node.tagName === 'SCRIPT' && node.src) node.src = fixUrl(node.src);
              if (node.tagName === 'IMG' && node.src) node.src = fixUrl(node.src);
            }
          });
        });
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
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
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });
    
    const contentType = response.headers.get('content-type') || '';
    
    // Handle HTML - rewrite URLs
    if (contentType.includes('text/html')) {
      let html = await response.text();
      const proxyBaseUrl = `${req.protocol}://${req.get('host')}/proxy`;
      html = rewriteHtml(html, targetUrl, proxyBaseUrl);
      
      // Remove iframe-blocking headers
      res.setHeader('X-Frame-Options', 'ALLOWALL');
      res.setHeader('Content-Security-Policy', "frame-ancestors *; default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;");
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      
      return res.send(html);
    }
    
    // Handle CSS, JS, images - just pass through with correct headers
    const buffer = await response.arrayBuffer();
    
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.send(Buffer.from(buffer));
    
  } catch (error) {
    console.error('❌ Proxy error:', error.message);
    res.status(500).json({ error: 'Failed to fetch URL: ' + error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Fanter Search Proxy with CSS rewriting!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Fanter Search Proxy running on port ${PORT}`);
});
