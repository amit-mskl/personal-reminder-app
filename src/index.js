const express = require('express');
const { urlencoded } = require('express');
const config = require('./config');
const webhookRouter = require('./routes/webhook');
const voiceRouter = require('./routes/voice');
const { startScheduler } = require('./services/scheduler');

const app = express();

// Twilio sends webhooks as URL-encoded form data
app.use(urlencoded({ extended: false }));

// Health check — Railway/Render pings this to know the app is alive
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Twilio WhatsApp webhook
app.use('/webhook', webhookRouter);

// Twilio Voice routes (call TwiML + audio + status)
app.use('/voice', voiceRouter);

app.listen(config.port, () => {
  console.log(`Bhoolanath listening on port ${config.port}`);
  startScheduler();
});
