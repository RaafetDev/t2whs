const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_FILE = path.join(__dirname, 'proxy-config.json');

// Default configuration
const DEFAULT_CONFIG = {
  proxy: {
    host: 'ep01.goodextensions.mooo.com',
    port: 443,
    user: 'mixtura',
    pass: 'mixtura'
  },
  onion: {
    host: 'http://qd5y2p2s5ufxaz4dapjwkvjav5xnhfgngaw2y24syfwlxjkipswdlpid.onion'
  }
};

// Load or create config
let config = loadConfig();

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      const loaded = JSON.parse(data);
      console.log('[CONFIG] Loaded from file');
      return loaded;
    } else {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
      console.log('[CONFIG] Created default config file');
      return DEFAULT_CONFIG;
    }
  } catch (error) {
    console.error('[CONFIG] Error loading config:', error.message);
    return DEFAULT_CONFIG;
  }
}

function saveConfig(newConfig) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
    console.log('[CONFIG] Saved to file');
    return true;
  } catch (error) {
    console.error('[CONFIG] Error saving config:', error.message);
    return false;
  }
}

function getProxyAuth() {
  return 'Basic ' + Buffer.from(`${config.proxy.user}:${config.proxy.pass}`).toString('base64');
}

// Watch config file for changes
fs.watch(CONFIG_FILE, (eventType, filename) => {
  if (eventType === 'change') {
    console.log('[CONFIG] File changed, reloading...');
    setTimeout(() => {
      config = loadConfig();
      console.log(`[CONFIG] Updated - Onion: ${config.onion.host}`);
    }, 100);
  }
});

// Middleware
app.use(express.json());
app.use(express.raw({ type: '*/*', limit: '10mb' }));

// Function to make request through HTTP proxy
function proxyRequest(targetUrl, method, headers, body) {
  return new Promise((resolve, reject) => {
    const parsedTarget = new URL(targetUrl);
    const isHttps = parsedTarget.protocol === 'https:';
    
    if (isHttps) {
      // For HTTPS, we need to use CONNECT tunnel
      const connectOptions = {
        host: config.proxy.host,
        port: config.proxy.port,
        method: 'CONNECT',
        path: `${parsedTarget.hostname}:443`,
        headers: {
          'Proxy-Authorization': getProxyAuth(),
          'Host': `${parsedTarget.hostname}:443`
        }
      };

      const proxyReq = https.request(connectOptions);
      
      proxyReq.on('connect', (res, socket, head) => {
        if (res.statusCode !== 200) {
          reject(new Error(`CONNECT failed with status ${res.statusCode}`));
          return;
        }

        // Now make HTTPS request through the tunnel
        const httpsOptions = {
          hostname: parsedTarget.hostname,
          port: 443,
          path: parsedTarget.pathname + parsedTarget.search,
          method: method,
          headers: headers,
          socket: socket,
          agent: false,
          rejectUnauthorized: false
        };

        const httpsReq = https.request(httpsOptions, (httpsRes) => {
          let chunks = [];
          
          httpsRes.on('data', (chunk) => {
            chunks.push(chunk);
          });
          
          httpsRes.on('end', () => {
            resolve({
              status: httpsRes.statusCode,
              headers: httpsRes.headers,
              body: Buffer.concat(chunks)
            });
          });
        });

        httpsReq.on('error', (err) => {
          reject(err);
        });

        if (body && method !== 'GET' && method !== 'HEAD') {
          httpsReq.write(body);
        }
        
        httpsReq.end();
      });

      proxyReq.on('error', (err) => {
        reject(err);
      });

      proxyReq.end();
      
    } else {
      // For HTTP, use standard proxy request
      const options = {
        host: config.proxy.host,
        port: config.proxy.port,
        method: method,
        path: targetUrl,
        headers: {
          ...headers,
          'Host': parsedTarget.hostname,
          'Proxy-Authorization': getProxyAuth()
        },
        timeout: 60000,
        rejectUnauthorized: false
      };

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
    }
  });
}

// Update endpoint
app.post('/___update', express.json(), (req, res) => {
  try {
    const updates = req.body;
    
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ 
        error: 'Invalid request', 
        message: 'Request body must be a JSON object' 
      });
    }

    // Apply updates to config
    if (updates.onion?.host) {
      config.onion.host = updates.onion.host;
    }
    if (updates.proxy?.host) {
      config.proxy.host = updates.proxy.host;
    }
    if (updates.proxy?.port) {
      config.proxy.port = updates.proxy.port;
    }
    if (updates.proxy?.user) {
      config.proxy.user = updates.proxy.user;
    }
    if (updates.proxy?.pass) {
      config.proxy.pass = updates.proxy.pass;
    }

    // Save updated config
    if (saveConfig(config)) {
      console.log(`[UPDATE] Config updated - Onion: ${config.onion.host}`);
      res.json({
        success: true,
        message: 'Configuration updated',
        config: {
          onion: config.onion,
          proxy: {
            host: config.proxy.host,
            port: config.proxy.port,
            user: config.proxy.user
          }
        }
      });
    } else {
      res.status(500).json({ error: 'Failed to save configuration' });
    }
  } catch (error) {
    console.error('[UPDATE] Error:', error.message);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Get current config
app.get('/___config', (req, res) => {
  res.json({
    onion: config.onion,
    proxy: {
      host: config.proxy.host,
      port: config.proxy.port,
      user: config.proxy.user
    }
  });
});

// Main proxy handler
app.all('*', async (req, res) => {
  // Skip special endpoints and favicon
  if (req.url === '/favicon.ico' || req.url.startsWith('/___')) {
    return;
  }

  try {
    // Build target URL with protocol from config
    let onionUrl = config.onion.host;
    
    // Ensure protocol is included
    if (!onionUrl.startsWith('http://') && !onionUrl.startsWith('https://')) {
      onionUrl = 'http://' + onionUrl;
    }
    
    // Parse base URL and append request path
    const baseUrl = new URL(onionUrl);
    const targetUrl = `${baseUrl.protocol}//${baseUrl.hostname}${req.url}`;
    
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} -> ${targetUrl}`);
    
    // Pass ALL headers from client unchanged
    const headers = { ...req.headers };
    
    // Only remove internal proxy/forwarding headers
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];

    // Make request
    const response = await proxyRequest(targetUrl, req.method, headers, req.body);

    console.log(`[${new Date().toISOString()}] Response: ${response.status}`);

    // Copy ALL response headers unchanged
    const responseHeaders = { ...response.headers };
    
    // Only remove transfer-encoding (Express handles this)
    delete responseHeaders['transfer-encoding'];

    // Handle redirects - rewrite location headers for both http and https
    if (responseHeaders.location) {
      const onionBase = baseUrl.protocol + '//' + baseUrl.hostname;
      responseHeaders.location = responseHeaders.location.replace(
        new RegExp(onionBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
        `${req.protocol}://${req.get('host')}`
      );
    }

    // Send response with original headers
    res.status(response.status);
    Object.keys(responseHeaders).forEach(key => {
      res.setHeader(key, responseHeaders[key]);
    });
    res.send(response.body);

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Proxy error:`, error.message);
    
    if (!res.headersSent) {
      // Parse onion URL for error display
      let displayHost = config.onion.host;
      try {
        const parsed = new URL(displayHost.startsWith('http') ? displayHost : 'http://' + displayHost);
        displayHost = parsed.href;
      } catch (e) {
        displayHost = config.onion.host;
      }
      
      res.status(502).json({
        error: 'Bad Gateway',
        message: 'Failed to connect to onion service',
        details: error.message,
        onion: displayHost,
        proxy: `${config.proxy.host}:${config.proxy.port}`
      });
    }
  }
});

// Health check
app.get('/__health', (req, res) => {
  // Parse onion URL to show just hostname
  let onionHost = config.onion.host;
  try {
    const parsed = new URL(onionHost.startsWith('http') ? onionHost : 'http://' + onionHost);
    onionHost = parsed.hostname;
  } catch (e) {
    // Keep as-is if parsing fails
  }
  
  res.json({ 
    status: 'ok', 
    onion: config.onion.host,
    onion_hostname: onionHost,
    proxy: `${config.proxy.host}:${config.proxy.port}`,
    timestamp: new Date().toISOString()
  });
});

const server = app.listen(PORT, () => {
  // Parse onion URL for display
  let displayHost = config.onion.host;
  try {
    const parsed = new URL(displayHost.startsWith('http') ? displayHost : 'http://' + displayHost);
    displayHost = parsed.href;
  } catch (e) {
    displayHost = config.onion.host;
  }
  
  console.log(`Tor2Web proxy running on port ${PORT}`);
  console.log(`Proxying to: ${displayHost}`);
  console.log(`Via Tor proxy: ${config.proxy.host}:${config.proxy.port}`);
  console.log(`Config file: ${CONFIG_FILE}`);
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
