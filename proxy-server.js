const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const port = process.env.PROXY_PORT || 3001;

// Use cors middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000'
}));

app.use(express.json());

app.post('/api/publicAPI/v2/timeseries/data', async (req, res) => {
  try {
    const response = await axios.post('https://api.bls.gov/publicAPI/v2/timeseries/data/', req.body);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'An error occurred' });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Proxy server running on port ${port}`);
});