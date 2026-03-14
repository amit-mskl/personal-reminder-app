const twilio = require('twilio');
const config = require('../config');

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

// Place an outbound voice call for a reminder
async function placeReminderCall(reminder) {
  const call = await client.calls.create({
    to: reminder.phone,
    from: config.twilio.phoneNumber,
    url: `${config.baseUrl}/voice/reminder/${reminder.id}`,
    statusCallback: `${config.baseUrl}/voice/status`,
    statusCallbackEvent: ['completed', 'no-answer', 'failed', 'busy'],
    statusCallbackMethod: 'POST',
    timeout: 30,
  });
  return call;
}

// Send a WhatsApp message
async function sendWhatsAppMessage(phone, body) {
  return client.messages.create({
    to: `whatsapp:${phone}`,
    from: `whatsapp:${config.twilio.whatsappNumber}`,
    body: body,
  });
}

module.exports = { placeReminderCall, sendWhatsAppMessage };
