const express = require('express');
const { MessagingResponse } = require('twilio').twiml;

const router = express.Router();

router.post('/whatsapp', (req, res) => {
  const from = req.body.From;       // e.g. "whatsapp:+919876543210"
  const body = req.body.Body || '';
  const numMedia = parseInt(req.body.NumMedia || '0');

  console.log(`Message from ${from}: ${body} (media: ${numMedia})`);

  // For now, just echo back what the user said
  const twiml = new MessagingResponse();

  if (numMedia > 0) {
    twiml.message('I received your voice note! (transcription coming soon)');
  } else {
    twiml.message(`You said: ${body}`);
  }

  res.type('text/xml').send(twiml.toString());
});

module.exports = router;
