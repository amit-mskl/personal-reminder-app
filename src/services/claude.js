const Anthropic = require('@anthropic-ai/sdk');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const config = require('../config');
const db = require('../db');

dayjs.extend(utc);
dayjs.extend(timezone);

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

// The 5 tools Claude can use to take action
const tools = [
  {
    name: 'create_reminder',
    description: 'Create a new reminder for the user',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'What to remind the user about' },
        remind_at: { type: 'string', description: 'ISO 8601 UTC datetime for the reminder' },
      },
      required: ['message', 'remind_at'],
    },
  },
  {
    name: 'reschedule_reminder',
    description: 'Reschedule an existing reminder to a new time',
    input_schema: {
      type: 'object',
      properties: {
        reminder_id: { type: 'integer', description: 'The ID of the reminder to reschedule' },
        new_remind_at: { type: 'string', description: 'New ISO 8601 UTC datetime' },
      },
      required: ['reminder_id', 'new_remind_at'],
    },
  },
  {
    name: 'add_follow_up_note',
    description: 'Add a follow-up note to an existing reminder',
    input_schema: {
      type: 'object',
      properties: {
        reminder_id: { type: 'integer', description: 'The ID of the reminder' },
        note: { type: 'string', description: 'The follow-up note to add' },
      },
      required: ['reminder_id', 'note'],
    },
  },
  {
    name: 'cancel_reminder',
    description: 'Cancel a pending reminder',
    input_schema: {
      type: 'object',
      properties: {
        reminder_id: { type: 'integer', description: 'The ID of the reminder to cancel' },
      },
      required: ['reminder_id'],
    },
  },
  {
    name: 'list_reminders',
    description: 'List all pending reminders for the user',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

// Build the system prompt with current time and user context
function buildSystemPrompt(phone) {
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  const tz = user ? user.timezone : 'Asia/Kolkata';
  const now = dayjs().tz(tz);

  const pendingReminders = db.prepare(
    "SELECT id, message, remind_at FROM reminders WHERE phone = ? AND status = 'pending' ORDER BY remind_at"
  ).all(phone);

  const recentReminders = db.prepare(
    "SELECT id, message, remind_at, status FROM reminders WHERE phone = ? AND status IN ('completed', 'triggered') ORDER BY updated_at DESC LIMIT 5"
  ).all(phone);

  let pendingList = 'None';
  if (pendingReminders.length > 0) {
    pendingList = pendingReminders
      .map((r) => `#${r.id} - "${r.message}" - ${dayjs.utc(r.remind_at).tz(tz).format('ddd MMM D, h:mm A')}`)
      .join('\n');
  }

  let recentList = 'None';
  if (recentReminders.length > 0) {
    recentList = recentReminders
      .map((r) => `#${r.id} - "${r.message}" - ${dayjs.utc(r.remind_at).tz(tz).format('ddd MMM D, h:mm A')} [${r.status}]`)
      .join('\n');
  }

  return `You are Bhoolanath, a friendly WhatsApp reminder assistant. Your name means "the forgetful one" in Hindi — which is ironic because you never forget!

Your job is to help users set, manage, and track reminders via WhatsApp.

CURRENT DATE/TIME (UTC): ${dayjs.utc().format('YYYY-MM-DD HH:mm')}
USER'S TIMEZONE: ${tz}
USER'S LOCAL TIME: ${now.format('ddd MMM D, YYYY h:mm A')}

PENDING REMINDERS:
${pendingList}

RECENTLY COMPLETED REMINDERS:
${recentList}

RULES:
1. When the user wants to set a reminder, extract the reminder text and the date/time. If the date/time is ambiguous or missing, ask for clarification conversationally.
2. Default times: "morning" = 9:00 AM, "afternoon" = 2:00 PM, "evening" = 6:00 PM, "night" = 9:00 PM in the user's timezone.
3. When the user's message has a clear reminder and time, create it immediately and confirm it's done. Do NOT ask "Should I set this?" — just set it. Only ask for clarification if the message is genuinely ambiguous (e.g., missing time or unclear what to remind about).
4. When rescheduling, identify which reminder by ID or context from the pending or recently completed lists above. Use the reschedule_reminder tool — do NOT create a new reminder.
5. Keep responses short and friendly — this is WhatsApp, not email.
6. If the user says something unrelated to reminders, respond briefly and steer back to reminders.
7. All datetimes you return in tool calls MUST be in ISO 8601 UTC format (e.g., 2026-03-14T09:30:00Z).
8. When the user confirms (yes, yep, do it, sure, etc.), execute the action by calling the appropriate tool.`;
}

// Load recent conversation history for context
function getConversationHistory(phone) {
  const rows = db.prepare(
    'SELECT role, content FROM conversations WHERE phone = ? ORDER BY created_at DESC LIMIT 10'
  ).all(phone);

  // Reverse so oldest is first (Claude expects chronological order)
  return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
}

// Save a message to conversation history
function saveConversation(phone, role, content) {
  db.prepare(
    'INSERT INTO conversations (phone, role, content) VALUES (?, ?, ?)'
  ).run(phone, role, content);
}

// Ensure user exists in the users table
function ensureUser(phone) {
  db.prepare(
    'INSERT OR IGNORE INTO users (phone) VALUES (?)'
  ).run(phone);
}

// Execute a tool action and return a result message
function executeAction(toolName, input, phone) {
  switch (toolName) {
    case 'create_reminder': {
      db.prepare(
        'INSERT INTO reminders (phone, message, remind_at) VALUES (?, ?, ?)'
      ).run(phone, input.message, input.remind_at);
      return `Reminder created: "${input.message}" at ${input.remind_at}`;
    }
    case 'reschedule_reminder': {
      db.prepare(
        "UPDATE reminders SET remind_at = ?, status = 'pending', updated_at = datetime('now') WHERE id = ? AND phone = ?"
      ).run(input.new_remind_at, input.reminder_id, phone);
      return `Reminder #${input.reminder_id} rescheduled to ${input.new_remind_at}`;
    }
    case 'add_follow_up_note': {
      const reminder = db.prepare('SELECT follow_up_notes FROM reminders WHERE id = ? AND phone = ?').get(input.reminder_id, phone);
      const notes = reminder && reminder.follow_up_notes ? JSON.parse(reminder.follow_up_notes) : [];
      notes.push(input.note);
      db.prepare(
        "UPDATE reminders SET follow_up_notes = ?, updated_at = datetime('now') WHERE id = ? AND phone = ?"
      ).run(JSON.stringify(notes), input.reminder_id, phone);
      return `Note added to reminder #${input.reminder_id}`;
    }
    case 'cancel_reminder': {
      db.prepare(
        "UPDATE reminders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND phone = ?"
      ).run(input.reminder_id, phone);
      return `Reminder #${input.reminder_id} cancelled`;
    }
    case 'list_reminders': {
      const reminders = db.prepare(
        "SELECT id, message, remind_at FROM reminders WHERE phone = ? AND status = 'pending' ORDER BY remind_at"
      ).all(phone);
      if (reminders.length === 0) return 'No pending reminders';
      return reminders.map((r) => `#${r.id}: "${r.message}" at ${r.remind_at}`).join('\n');
    }
    default:
      return 'Unknown action';
  }
}

// Main function: process a user message and return a reply
async function processMessage(phone, userText) {
  ensureUser(phone);

  const history = getConversationHistory(phone);
  const systemPrompt = buildSystemPrompt(phone);

  const messages = [...history, { role: 'user', content: userText }];

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    tools: tools,
    messages: messages,
  });

  let replyText = '';
  for (const block of response.content) {
    if (block.type === 'text') {
      replyText += block.text;
    } else if (block.type === 'tool_use') {
      const result = executeAction(block.name, block.input, phone);
      console.log(`Tool: ${block.name} -> ${result}`);
    }
  }

  // Save both sides of the conversation
  saveConversation(phone, 'user', userText);
  saveConversation(phone, 'assistant', replyText);

  return replyText;
}

module.exports = { processMessage };
