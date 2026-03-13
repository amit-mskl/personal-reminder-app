const config = require('../config');

// Transcribe a voice note using Sarvam AI STT
async function transcribeVoiceNote(mediaUrl) {
  // Download the audio file from Twilio (requires auth)
  const audioResponse = await fetch(mediaUrl, {
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString('base64'),
    },
  });

  if (!audioResponse.ok) {
    throw new Error(`Failed to download audio: ${audioResponse.status}`);
  }

  const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());

  // Send to Sarvam STT API as multipart form data
  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), 'voice.ogg');
  formData.append('model', 'saaras:v2');
  formData.append('language_code', 'unknown');

  const response = await fetch('https://api.sarvam.ai/speech-to-text', {
    method: 'POST',
    headers: {
      'api-subscription-key': config.sarvamApiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Sarvam STT failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  return result.transcript;
}

// Generate speech from text using Sarvam AI TTS (for reminder calls)
async function generateSpeech(text, speaker = 'shubh') {
  const response = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: {
      'api-subscription-key': config.sarvamApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: text,
      target_language_code: 'en-IN',
      speaker: speaker,
      model: 'bulbul:v2',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Sarvam TTS failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  // Returns base64-encoded WAV audio
  return result.audios[0];
}

module.exports = { transcribeVoiceNote, generateSpeech };
