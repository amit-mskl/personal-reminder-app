const express = require('express');
const { VoiceResponse } = require('twilio').twiml;
const db = require('../db');
const { sendWhatsAppMessage } = require('../services/twilio');

const router = express.Router();

// Twilio calls this URL to get instructions for the voice call
router.post('/reminder/:id', (req, res) => {
  const reminder = db.prepare('SELECT * FROM reminders WHERE id = ?').get(req.params.id);
  const twiml = new VoiceResponse();

  if (!reminder) {
    twiml.say('Sorry, this reminder was not found.');
  } else {
    twiml.say(
      { voice: 'Polly.Aditi', language: 'en-IN' },
      `Hello! This is Bhoolanath, your reminder assistant. You asked me to remind you: ${reminder.message}.`
    );
    twiml.pause({ length: 1 });
    twiml.say(
      { voice: 'Polly.Aditi', language: 'en-IN' },
      'I have sent you a message on WhatsApp where you can reschedule or add notes. Have a great day!'
    );
  }

  res.type('text/xml').send(twiml.toString());
});

// Serve the pre-generated WAV audio for a reminder
router.get('/audio/:id', (req, res) => {
  const reminder = db.prepare('SELECT audio_base64 FROM reminders WHERE id = ?').get(req.params.id);

  if (!reminder || !reminder.audio_base64) {
    return res.status(404).send('Audio not found');
  }

  const audioBuffer = Buffer.from(reminder.audio_base64, 'base64');
  res.set('Content-Type', 'audio/wav');
  res.send(audioBuffer);
});

// Twilio calls this when the call ends — update status and send follow-up
router.post('/status', async (req, res) => {
  const callSid = req.body.CallSid;
  const callStatus = req.body.CallStatus; // completed, no-answer, failed, busy

  console.log(`Call ${callSid} status: ${callStatus}`);

  const reminder = db.prepare('SELECT * FROM reminders WHERE call_sid = ?').get(callSid);

  if (reminder) {
    db.prepare(
      "UPDATE reminders SET call_status = ?, status = 'completed', updated_at = datetime('now') WHERE id = ?"
    ).run(callStatus, reminder.id);

    // Send follow-up WhatsApp message
    try {
      if (callStatus === 'completed') {
        await sendWhatsAppMessage(
          reminder.phone,
          `✅ Your reminder "${reminder.message}" was delivered!\n\nReply to reschedule or add follow-up notes.`
        );
      } else {
        await sendWhatsAppMessage(
          reminder.phone,
          `📞 I tried calling you about "${reminder.message}" but couldn't reach you.\n\nWant me to try again? Or reply to reschedule.`
        );
      }
    } catch (err) {
      console.error('Failed to send follow-up WhatsApp:', err);
    }
  }

  res.sendStatus(200);
});

module.exports = router;
