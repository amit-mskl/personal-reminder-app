const express = require('express');
const { MessagingResponse } = require('twilio').twiml;
const { processMessage } = require('../services/claude');
const { transcribeVoiceNote } = require('../services/sarvam');

const router = express.Router();

router.post('/whatsapp', async (req, res) => {
  const from = req.body.From;       // e.g. "whatsapp:+919876543210"
  const body = req.body.Body || '';
  const numMedia = parseInt(req.body.NumMedia || '0');

  // Extract phone number: "whatsapp:+919876543210" -> "+919876543210"
  const phone = from.replace('whatsapp:', '');

  console.log(`Message from ${phone}: ${body} (media: ${numMedia})`);

  let userText = body;

  if (numMedia > 0 && req.body.MediaContentType0 === 'audio/ogg') {
    try {
      console.log('Transcribing voice note...');
      userText = await transcribeVoiceNote(req.body.MediaUrl0);
      console.log(`Transcription: ${userText}`);
    } catch (err) {
      console.error('Transcription failed:', err);
      userText = '(voice note received but transcription failed)';
    }
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
