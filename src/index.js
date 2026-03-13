const express = require('express');
const { urlencoded } = require('express');
const config = require('./config');

const app = express();

// Twilio sends webhooks as URL-encoded form data
app.use(urlencoded({ extended: false }));

// Health check — Railway/Render pings this to know the app is alive
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(config.port, () => {
  console.log(`Bhoolanath listening on port ${config.port}`);
});
