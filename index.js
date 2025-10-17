const express = require('express');
const { HttpProxyAgent } = require('http-proxy-agent');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Tor proxy configuration
const TOR_PROXY_HOST = 'ep01.goodextensions.mooo.com';
const TOR_PROXY_PORT = 443;
const TOR_PROXY_USER = 'mixtura';
const TOR_PROXY_PASS = 'mixtura';
const ONION_HOST = 'qd5y2p2s5ufxaz4dapjwkvjav5xnhfgngaw2y24syfwlxjkipswdlpid.onion';

// Create HTTP proxy agent with authentication (not HTTPS CONNECT)
const proxyUrl = `http://${TOR_PROXY_USER}:${TOR_PROXY_PASS}@${TOR_PROXY_HOST}:${TOR_PROXY_PORT}`;
const agent = new HttpProxyAgent(proxyUrl);

// Middleware to parse request body
app.use(express.raw({ type: '*/*', limit: '10mb' }));

// Main proxy handler
app.all('*', async (req, res) => {
  try {
    // Build target URL
    const targetUrl = `http://${ONION_HOST}${req.url}`;
    
    // Prepare headers (remove host and connection headers)
    const headers = { ...req.headers };
    delete headers.host;
    delete headers.connection;
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];
    
    // Make request through Tor proxy
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
      agent: agent,
      redirect: 'manual',
      timeout: 30000
    });

    // Copy response headers
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      // Skip transfer-encoding as express handles it
      if (key.toLowerCase() !== 'transfer-encoding') {
        responseHeaders[key] = value;
      }
    });

    // Handle redirects - rewrite location headers
    if (responseHeaders.location) {
      responseHeaders.location = responseHeaders.location.replace(
        new RegExp(`http://${ONION_HOST}`, 'g'),
        `${req.protocol}://${req.get('host')}`
      );
    }

    // Set response headers and status
    res.status(response.status);
    Object.keys(responseHeaders).forEach(key => {
      res.setHeader(key, responseHeaders[key]);
    });

    // Stream response body
    const buffer = await response.buffer();
    res.send(buffer);

  } catch (error) {
    console.error('Proxy error:', error.message);
    
    if (!res.headersSent) {
      res.status(502).json({
        error: 'Bad Gateway',
        message: 'Failed to connect to onion service',
        details: error.message
      });
    }
  }
});

// Health check endpoint
app.get('/__health', (req, res) => {
  res.json({ 
    status: 'ok', 
    onion: ONION_HOST,
    proxy: `${TOR_PROXY_HOST}:${TOR_PROXY_PORT}`
  });
});

app.listen(PORT, () => {
  console.log(`Tor2Web proxy running on port ${PORT}`);
  console.log(`Proxying to: ${ONION_HOST}`);
  console.log(`Via Tor proxy: ${TOR_PROXY_HOST}:${TOR_PROXY_PORT}`);
});
