const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const port = process.env.PROXY_PORT || 3001; // Use Heroku's provided port or 3001 as fallback

app.use(bodyParser.json());
app.use(cors()); // Enable CORS for all routes

app.post('/api/publicAPI/v2/timeseries/data', async (req, res) => {
  try {
    const response = await axios.post('https://api.bls.gov/publicAPI/v2/timeseries/data/', req.body, {
      headers: { 'Content-Type': 'application/json' }
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    res.status(error.response ? error.response.status : 500).json(error.response ? error.response.data : { error: 'Internal Server Error' });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Proxy server running on port ${port}`);
});