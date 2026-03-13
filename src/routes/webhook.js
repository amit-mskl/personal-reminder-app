const express = require('express');
const { MessagingResponse } = require('twilio').twiml;
const { processMessage } = require('../services/claude');

const router = express.Router();

router.post('/whatsapp', async (req, res) => {
  const from = req.body.From;       // e.g. "whatsapp:+919876543210"
  const body = req.body.Body || '';
  const numMedia = parseInt(req.body.NumMedia || '0');

  // Extract phone number: "whatsapp:+919876543210" -> "+919876543210"
  const phone = from.replace('whatsapp:', '');

  console.log(`Message from ${phone}: ${body} (media: ${numMedia})`);

  let userText = body;

  if (numMedia > 0) {
    // Voice note transcription coming in Step 7
    userText = '(voice note received — transcription coming soon)';
  }

  try {
    const reply = await processMessage(phone, userText);
    const twiml = new MessagingResponse();
    twiml.message(reply);
    res.type('text/xml').send(twiml.toString());
  } catch (err) {
    console.error('Error processing message:', err);
    const twiml = new MessagingResponse();
    twiml.message('Sorry, something went wrong. Please try again.');
    res.type('text/xml').send(twiml.toString());
  }
});

module.exports = router;
