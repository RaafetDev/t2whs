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
    host: 'ttcbgkpnl6at7dqhroa2shu44zqxzpwwwvdxbzoqznxk7lg5xso6bbqd.onion'
  },
  headers: {
    //'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; rv:102.0) Gecko/20100101 Firefox/102.0',
    //'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    /*'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-User': '?1',
    'DNT': '1'*/
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
    
    const options = {
      host: config.proxy.host,
      port: config.proxy.port,
      method: method,
      path: targetUrl,
      headers: {
        'Host': parsedTarget.hostname,
        'Proxy-Authorization': getProxyAuth(),
        'Connection': 'keep-alive',
        ...headers
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
    },
    headers: config.headers
  });
});

// Main proxy handler
app.all('*', async (req, res) => {
  // Skip special endpoints and favicon
  if (req.url === '/favicon.ico' || req.url.startsWith('/___')) {
    return;
  }

  try {
    const targetUrl = `http://${config.onion.host}${req.url}`;
    
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    
    // Use configured headers
    const headers = { ...config.headers };

    // Copy safe headers from request
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
        new RegExp(`http://${config.onion.host}`, 'g'),
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
        onion: config.onion.host,
        proxy: `${config.proxy.host}:${config.proxy.port}`
      });
    }
  }
});

// Health check
app.get('/__health', (req, res) => {
  res.json({ 
    status: 'ok', 
    onion: config.onion.host,
    proxy: `${config.proxy.host}:${config.proxy.port}`,
    timestamp: new Date().toISOString()
  });
});

const server = app.listen(PORT, () => {
  console.log(`Tor2Web proxy running on port ${PORT}`);
  console.log(`Proxying to: ${config.onion.host}`);
  console.log(`Via Tor proxy: ${config.proxy.host}:${config.proxy.port}`);
  console.log(`Config file: ${CONFIG_FILE}`);
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
