const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

// Tor proxy configuration
const TOR_PROXY_HOST = 'ep01.goodextensions.mooo.com';
const TOR_PROXY_PORT = 443;
const TOR_PROXY_USER = 'mixtura';
const TOR_PROXY_PASS = 'mixtura';
const ONION_HOST = 'qd5y2p2s5ufxaz4dapjwkvjav5xnhfgngaw2y24syfwlxjkipswdlpid.onion';

// Create auth header
const proxyAuth = 'Basic ' + Buffer.from(`${TOR_PROXY_USER}:${TOR_PROXY_PASS}`).toString('base64');

// Middleware to parse request body
app.use(express.raw({ type: '*/*', limit: '10mb' }));

// Function to make request through HTTP proxy
function proxyRequest(targetUrl, method, headers, body) {
  return new Promise((resolve, reject) => {
    const parsedTarget = new URL(targetUrl);
    
    // Build proxy request
    const options = {
      host: TOR_PROXY_HOST,
      port: TOR_PROXY_PORT,
      method: method,
      path: targetUrl, // Full URL as path for HTTP proxy
      headers: {
        'Host': parsedTarget.hostname,
        'Proxy-Authorization': proxyAuth,
        'Connection': 'keep-alive',
        ...headers
      },
      timeout: 60000,
      rejectUnauthorized: false // Disable SSL verification for proxy
    };

    // Use HTTPS for proxy connection on port 443
    const client = https;
    
    const proxyReq = client.request(options, (proxyRes) => {
      let chunks = [];
      
      proxyRes.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      proxyRes.on('end', () => {
        resolve({
          status: proxyRes.statusCode,
          headers: proxyRes.headers,
          body: Buffer.concat(chunks)
        });
      });
    });

    proxyReq.on('error', (err) => {
      reject(err);
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      reject(new Error('Request timeout'));
    });

    if (body && method !== 'GET' && method !== 'HEAD') {
      proxyReq.write(body);
    }
    
    proxyReq.end();
  });
}

// Main proxy handler
app.all('*', async (req, res) => {
  // Skip favicon
  if (req.url === '/favicon.ico') {
    return res.status(204).end();
  }

  try {
    const targetUrl = `http://${ONION_HOST}${req.url}`;
    
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    
    // Prepare headers - Tor Browser fingerprint
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; rv:102.0) Gecko/20100101 Firefox/102.0',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-User': '?1',
      'DNT': '1'
    };

    // Copy safe headers
    const safeToCopy = ['cookie', 'referer', 'content-type', 'content-length', 'authorization'];
    safeToCopy.forEach(h => {
      if (req.headers[h]) {
        headers[h] = req.headers[h];
      }
    });

    // Make request
    const response = await proxyRequest(targetUrl, req.method, headers, req.body);

    console.log(`[${new Date().toISOString()}] Response: ${response.status}`);

    // Copy response headers
    const responseHeaders = { ...response.headers };
    delete responseHeaders['transfer-encoding'];
    delete responseHeaders['connection'];

    // Handle redirects
    if (responseHeaders.location) {
      responseHeaders.location = responseHeaders.location.replace(
        new RegExp(`http://${ONION_HOST}`, 'g'),
        `${req.protocol}://${req.get('host')}`
      );
    }

    // Send response
    res.status(response.status);
    Object.keys(responseHeaders).forEach(key => {
      res.setHeader(key, responseHeaders[key]);
    });
    res.send(response.body);

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Proxy error:`, error.message);
    
    if (!res.headersSent) {
      res.status(502).json({
        error: 'Bad Gateway',
        message: 'Failed to connect to onion service',
        details: error.message,
        proxy: `${TOR_PROXY_HOST}:${TOR_PROXY_PORT}`
      });
    }
  }
});

// Health check
app.get('/__health', (req, res) => {
  res.json({ 
    status: 'ok', 
    onion: ONION_HOST,
    proxy: `${TOR_PROXY_HOST}:${TOR_PROXY_PORT}`,
    timestamp: new Date().toISOString()
  });
});

const server = app.listen(PORT, () => {
  console.log(`Tor2Web proxy running on port ${PORT}`);
  console.log(`Proxying to: ${ONION_HOST}`);
  console.log(`Via Tor proxy: ${TOR_PROXY_HOST}:${TOR_PROXY_PORT}`);
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
