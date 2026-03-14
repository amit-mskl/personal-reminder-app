const cron = require('node-cron');
const db = require('../db');
const { generateSpeech } = require('./sarvam');
const { placeReminderCall, sendWhatsAppMessage } = require('./twilio');

function startScheduler() {
  // Run every minute
  cron.schedule('* * * * *', async () => {
    const now = new Date().toISOString();

    // Find all pending reminders that are due
    const dueReminders = db.prepare(
      "SELECT * FROM reminders WHERE status = 'pending' AND remind_at <= ?"
    ).all(now);

    for (const reminder of dueReminders) {
      await triggerReminder(reminder);
    }
  });

  console.log('Scheduler started (checking every minute)');
}

async function triggerReminder(reminder) {
  // Mark as triggered immediately to prevent double-firing
  const result = db.prepare(
    "UPDATE reminders SET status = 'triggered', updated_at = datetime('now') WHERE id = ? AND status = 'pending'"
  ).run(reminder.id);

  // If no rows changed, another scheduler tick already got it
  if (result.changes === 0) return;

  console.log(`Triggering reminder #${reminder.id}: "${reminder.message}"`);

  try {
    // Generate audio using Sarvam TTS
    const speechText = `Hello! This is Bhoolanath, your reminder assistant. You asked me to remind you: ${reminder.message}. I have sent you a message on WhatsApp where you can reschedule or add notes. Have a great day!`;
    const audioBase64 = await generateSpeech(speechText);

    // Cache the audio in the database
    db.prepare(
      "UPDATE reminders SET audio_base64 = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(audioBase64, reminder.id);

    // Place the voice call
    const call = await placeReminderCall(reminder);

    // Store the call SID for tracking
    db.prepare(
      "UPDATE reminders SET call_sid = ?, call_status = 'queued', updated_at = datetime('now') WHERE id = ?"
    ).run(call.sid, reminder.id);

    console.log(`Call placed for reminder #${reminder.id}, SID: ${call.sid}`);
  } catch (err) {
    console.error(`Failed to call for reminder #${reminder.id}:`, err);

    // Fallback: send WhatsApp message instead
    try {
      await sendWhatsAppMessage(
        reminder.phone,
        `⏰ Reminder: ${reminder.message}\n\n(I tried to call you but couldn't get through. Reply to reschedule or add notes.)`
      );
    } catch (whatsappErr) {
      console.error('WhatsApp fallback also failed:', whatsappErr);
    }

    db.prepare(
      "UPDATE reminders SET status = 'completed', call_status = 'failed', updated_at = datetime('now') WHERE id = ?"
    ).run(reminder.id);
  }
}

module.exports = { startScheduler };
