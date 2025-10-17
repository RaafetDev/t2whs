const express = require('express');
const { HttpProxyAgent } = require('http-proxy-agent');
const fetch = require('node-fetch');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// Tor proxy configuration
const TOR_PROXY_HOST = 'ep01.goodextensions.mooo.com';
const TOR_PROXY_PORT = 443;
const TOR_PROXY_USER = 'mixtura';
const TOR_PROXY_PASS = 'mixtura';
const ONION_HOST = 'pflujznptk5lmuf6xwadfqy6nffykdvahfbljh7liljailjbxrgvhfid.onion';

// Create HTTP proxy agent with keep-alive and proper settings
const proxyUrl = `http://${TOR_PROXY_USER}:${TOR_PROXY_PASS}@${TOR_PROXY_HOST}:${TOR_PROXY_PORT}`;
const agent = new HttpProxyAgent(proxyUrl, {
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
  scheduling: 'lifo'
});

// Keep connection alive
setInterval(() => {
  // Prevent agent from timing out
}, 30000);

// Middleware to parse request body
app.use(express.raw({ type: '*/*', limit: '10mb' }));

// Main proxy handler
app.all('*', async (req, res) => {
  // Skip favicon if causing issues
  if (req.url === '/favicon.ico') {
    return res.status(204).end();
  }

  try {
    // Build target URL
    const targetUrl = `http://${ONION_HOST}${req.url}`;
    
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    
    // Prepare headers
    const headers = {
      ...req.headers,
      'Host': ONION_HOST,
      'Connection': 'keep-alive',
      'Accept': req.headers.accept || '*/*',
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };
    
    // Remove problematic headers
    delete headers['host'];
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];
    delete headers['x-forwarded-for'];
    delete headers['x-forwarded-proto'];
    delete headers['x-forwarded-host'];
    
    // Make request through Tor proxy with extended timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
      agent: agent,
      redirect: 'manual',
      signal: controller.signal,
      compress: true
    });

    clearTimeout(timeoutId);

    console.log(`[${new Date().toISOString()}] Response: ${response.status}`);

    // Copy response headers
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'transfer-encoding' && 
          key.toLowerCase() !== 'connection') {
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
    console.error(`[${new Date().toISOString()}] Proxy error:`, error.message);
    
    if (error.name === 'AbortError') {
      return res.status(504).json({
        error: 'Gateway Timeout',
        message: 'Request to onion service timed out'
      });
    }
    
    if (!res.headersSent) {
      res.status(502).json({
        error: 'Bad Gateway',
        message: 'Failed to connect to onion service',
        details: error.message,
        hint: 'The Tor proxy or onion service may be temporarily unavailable'
      });
    }
  }
});

// Health check endpoint
app.get('/__health', (req, res) => {
  res.json({ 
    status: 'ok', 
    onion: ONION_HOST,
    proxy: `${TOR_PROXY_HOST}:${TOR_PROXY_PORT}`,
    timestamp: new Date().toISOString()
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

const server = app.listen(PORT, () => {
  console.log(`Tor2Web proxy running on port ${PORT}`);
  console.log(`Proxying to: ${ONION_HOST}`);
  console.log(`Via Tor proxy: ${TOR_PROXY_HOST}:${TOR_PROXY_PORT}`);
});

// Increase server timeout
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
