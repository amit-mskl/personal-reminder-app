# Building Bhoolanath: A Step-by-Step Learning Journey

A complete guide to building a WhatsApp-based reminder app from scratch. This documents every step, error faced, and lesson learned — so anyone can follow along and build it independently.

---

## What We Built

**Bhoolanath** ("the forgetful one" in Hindi) is a WhatsApp contact that:
1. Accepts text messages or voice notes to set reminders
2. Understands natural language ("remind me to call mom tomorrow at 3pm")
3. Calls you on the phone when the reminder is due
4. Sends a WhatsApp follow-up after the call for rescheduling or notes

**Tech Stack:** Node.js + Express, Twilio (WhatsApp + Voice), Claude API (NLP), Sarvam AI (Speech-to-Text), SQLite

---

## Prerequisites

You'll need accounts on:
- [Twilio](https://www.twilio.com) (free trial gives $15 credit)
- [Anthropic](https://console.anthropic.com) (for Claude API key)
- [Sarvam AI](https://www.sarvam.ai) (for voice transcription, Rs 1000 free credits)
- [ngrok](https://ngrok.com) (free, for exposing localhost to the internet)
- [GitHub](https://github.com) (for version control)

Software: Node.js (v18+), Git, a terminal

---

## Step 1: Project Initialization

### 1a. Create the project

```bash
mkdir personal-reminder-app
cd personal-reminder-app
```

Create `package.json`:
```json
{
  "name": "bhoolanath",
  "version": "1.0.0",
  "description": "WhatsApp-based reminder app that calls you when it's time",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "dev": "nodemon src/index.js"
  },
  "keywords": ["whatsapp", "reminder", "twilio", "sarvam"],
  "license": "ISC"
}
```

**Why these scripts?**
- `npm start` — runs the server (for production)
- `npm run dev` — uses nodemon to auto-restart on code changes (for development)

### 1b. Install dependencies

```bash
npm install express twilio @anthropic-ai/sdk better-sqlite3 node-cron dayjs dotenv
```

| Package | Purpose |
|---|---|
| `express` | HTTP server for Twilio webhooks |
| `twilio` | SDK for WhatsApp messaging + voice calls |
| `@anthropic-ai/sdk` | Claude API for understanding messages |
| `better-sqlite3` | SQLite database (stores reminders) |
| `node-cron` | Runs the scheduler every minute |
| `dayjs` | Lightweight date/time handling with timezone support |
| `dotenv` | Loads `.env` file into environment variables |

**What's `2>&1` in shell commands?** It combines error output with normal output into one stream so you can see both warnings and results together. `2` = stderr, `1` = stdout, `>&1` = "redirect 2 into 1".

### 1c. Create `.env.example` and `.gitignore`

`.env.example` — template for environment variables (never commit real keys):
```
# Server
PORT=3000
BASE_URL=https://your-app.up.railway.app

# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890
TWILIO_WHATSAPP_NUMBER=+14155238886

# Anthropic (Claude API)
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx

# Sarvam AI
SARVAM_API_KEY=your_sarvam_api_key
```

`.gitignore` — prevent sensitive/generated files from being committed:
```
node_modules/
.env
data/
*.docx
```

### 1d. Initialize Git and push

```bash
git init
git branch -M main
git add .env.example .gitignore package.json package-lock.json
git commit -m "Initialize Bhoolanath project"
git remote add origin https://github.com/YOUR_USERNAME/personal-reminder-app.git
git push -u origin main
```

**Lesson learned:** `git init` creates a `master` branch by default, but GitHub uses `main`. Use `git branch -M main` to rename your branch before pushing. The `-M` flag means "force rename."

**What's PATH?** When you type a command like `node`, your computer looks through a list of folders (the PATH) to find the executable. If a program isn't in PATH, you need to specify the full path to run it.

---

## Step 2: Database Module

### Goal
Create SQLite tables to store users, reminders, and conversation history.

### Files created

**`src/db/schema.sql`** — defines three tables:

```sql
-- Users table: one row per WhatsApp user
CREATE TABLE IF NOT EXISTS users (
    phone TEXT PRIMARY KEY,
    name TEXT,
    timezone TEXT DEFAULT 'Asia/Kolkata',
    created_at TEXT DEFAULT (datetime('now'))
);

-- Reminders table: each reminder the user sets
CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    message TEXT NOT NULL,
    remind_at TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    call_sid TEXT,
    call_status TEXT,
    follow_up_notes TEXT,
    audio_base64 TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (phone) REFERENCES users(phone)
);

-- Conversation history: stores messages so Claude has context
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (phone) REFERENCES users(phone)
);

CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, remind_at);
CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(phone, created_at);
```

**Key design decisions:**
- All datetimes stored in **UTC** — timezone conversion happens in code
- `status` lifecycle: `pending` -> `triggered` -> `completed` (or `cancelled`)
- `follow_up_notes` is a JSON array stored as text
- `audio_base64` caches generated TTS audio
- Indexes speed up the two most frequent queries

**`src/db/index.js`** — connects to SQLite and runs the schema:

```javascript
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/bhoolanath.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');  // Better concurrent read performance
db.pragma('foreign_keys = ON');   // Enforce foreign key constraints

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

module.exports = db;
```

### Test it
```bash
node src/db/index.js
# Check that data/bhoolanath.db was created
ls data/
```

### Commit
```bash
git add src/db/schema.sql src/db/index.js
git commit -m "Add database module with SQLite schema"
git push
```

---

## Step 3: Express Server with Health Check

### Goal
Create a web server that listens for requests. Start with a `/health` endpoint.

### Files created

**`src/config.js`** — centralizes all environment variables:

```javascript
require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER,
    whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER,
  },
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  sarvamApiKey: process.env.SARVAM_API_KEY,
};
```

**`src/index.js`** — the Express server:

```javascript
const express = require('express');
const { urlencoded } = require('express');
const config = require('./config');

const app = express();
app.use(urlencoded({ extended: false }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(config.port, () => {
  console.log(`Bhoolanath listening on port ${config.port}`);
});
```

**Why `urlencoded`?** Twilio sends webhook data as form-encoded (like `From=whatsapp%3A%2B919876543210&Body=hello`). This middleware decodes it into `req.body`.

### Test it manually
1. Start: `npm start`
2. Open browser: `http://localhost:3000/health`
3. See: `{"status":"ok"}`
4. Stop: `Ctrl+C`

---

## Step 4: WhatsApp Webhook (Echo)

### Goal
Receive WhatsApp messages from Twilio and echo them back. This validates the Twilio-to-server connection.

### File created

**`src/routes/webhook.js`**:

```javascript
const express = require('express');
const { MessagingResponse } = require('twilio').twiml;
const router = express.Router();

router.post('/whatsapp', (req, res) => {
  const from = req.body.From;       // "whatsapp:+919876543210"
  const body = req.body.Body || '';
  const numMedia = parseInt(req.body.NumMedia || '0');

  console.log(`Message from ${from}: ${body} (media: ${numMedia})`);

  const twiml = new MessagingResponse();
  if (numMedia > 0) {
    twiml.message('I received your voice note! (transcription coming soon)');
  } else {
    twiml.message(`You said: ${body}`);
  }

  res.type('text/xml').send(twiml.toString());
});

module.exports = router;
```

**What's TwiML?** Twilio Markup Language — an XML format Twilio expects as a response. Example:
```xml
<Response><Message>You said: hello</Message></Response>
```

Wire it into `src/index.js` by adding:
```javascript
const webhookRouter = require('./routes/webhook');
app.use('/webhook', webhookRouter);
```

### Test with curl
```bash
npm start
# In another terminal:
curl -X POST http://localhost:3000/webhook/whatsapp \
  -d "From=whatsapp:+919876543210" \
  -d "Body=Remind me to call mom" \
  -d "NumMedia=0"
```

---

## Step 5: Claude API Integration

### Goal
Replace the echo with Claude-powered natural language understanding. This is the brain of the app.

### Key concept: Tool Use

Instead of parsing free-text responses, Claude uses **tools** — structured actions it can call:

| Tool | What it does |
|---|---|
| `create_reminder` | Create new reminder with message + datetime |
| `reschedule_reminder` | Change time on existing reminder |
| `add_follow_up_note` | Attach a note to a reminder |
| `cancel_reminder` | Cancel a pending reminder |
| `list_reminders` | Show all pending reminders |

Claude returns structured data like:
```json
{
  "name": "create_reminder",
  "input": { "message": "call mom", "remind_at": "2026-03-14T09:30:00Z" }
}
```

### Key concept: System Prompt

The system prompt tells Claude who it is and gives it context:
- Current date/time in the user's timezone
- All pending reminders (so it can reference them)
- Rules for interpreting natural language ("morning" = 9 AM, etc.)

### Key concept: Conversation History

We store the last 10 messages per user in the `conversations` table and send them to Claude with each request. This gives Claude memory across messages.

### File created

**`src/services/claude.js`** — see the full source in the repository. Key function:

```javascript
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

  // Process text replies and tool calls
  // Save conversation history
  // Return reply text
}
```

---

## Step 6: Wire Claude into Webhook

### Goal
Replace the echo reply with actual Claude-powered responses.

### Changes to `src/routes/webhook.js`
- Import `processMessage` from Claude service
- Make handler `async`
- Extract phone from `whatsapp:+91...` format
- Call `processMessage` instead of echoing
- Add try/catch for error handling

### First real test!
```bash
# Copy .env.example to .env and fill in your ANTHROPIC_API_KEY
cp .env.example .env
npm start

# Simulate a message:
curl -X POST http://localhost:3000/webhook/whatsapp \
  -d "From=whatsapp:+919876543210" \
  -d "Body=Remind me to call mom tomorrow at 3pm" \
  -d "NumMedia=0"
```

**Result:** Claude parsed the message, called `create_reminder`, and replied with confirmation.

---

## Step 7: Sarvam AI — Voice Note Transcription

### Goal
Transcribe WhatsApp voice notes using Sarvam AI's Speech-to-Text API.

### File created

**`src/services/sarvam.js`** — two functions:
- `transcribeVoiceNote(mediaUrl)` — downloads audio from Twilio, sends to Sarvam STT
- `generateSpeech(text)` — converts text to audio using Sarvam TTS (for calls)

### Error encountered: Wrong model name
```
Sarvam STT failed: 400 - body.model: Input should be 'saarika:v2.5', 'saaras:v3'...
```
**Fix:** Changed model from `saaras:v2` to `saaras:v3`. The API docs referenced v2, but the actual API only accepts specific model names.

**Lesson:** Always check error messages carefully — API providers update their model names and the docs may lag behind.

---

## Step 8-9: Scheduler + Voice Calls

### Goal
When a reminder is due, call the user and read out the reminder.

### Files created

**`src/services/twilio.js`** — Twilio SDK wrapper:
- `placeReminderCall(reminder)` — initiates outbound voice call
- `sendWhatsAppMessage(phone, body)` — sends WhatsApp text

**`src/services/scheduler.js`** — cron job that runs every minute:
1. Queries for `status = 'pending' AND remind_at <= now`
2. Atomically marks as `triggered` (prevents double-firing)
3. Places voice call via Twilio
4. Falls back to WhatsApp if call fails

**`src/routes/voice.js`** — three endpoints:
- `POST /voice/reminder/:id` — returns TwiML with `<Say>` instructions for the call
- `GET /voice/audio/:id` — serves pre-generated audio
- `POST /voice/status` — Twilio reports call outcome, we send follow-up WhatsApp

### Error encountered: Sarvam TTS wrong speaker
```
Speaker 'shubh' is not compatible with model bulbul:v2.
Available speakers for bulbul:v2 are: anushka, abhilash, manisha, vidya, arya, karun, hitesh
```
**Fix:** Changed default speaker from `shubh` (only available in v3) to `abhilash` (available in v2).

**Lesson:** Model versions have different available voices. Check compatibility.

### Error encountered: Twilio call says "application error"
The voice call connected but played "press any number" then "application error" instead of the reminder.

**Root cause:** ngrok's free tier shows a browser warning page on first access. When Twilio fetched the TwiML URL, it got HTML instead of XML.

**Fix:** Changed the voice endpoint from `GET` to `POST` (Twilio defaults to POST) and switched from Sarvam TTS audio playback (which required a second URL fetch) to Twilio's built-in `<Say>` with Polly.Aditi voice. This keeps everything inline in one TwiML response.

### Error encountered: Twilio trial can't call unverified numbers
The call failed because Twilio trial accounts can only call phone numbers you've verified.

**Fix:** Go to Twilio Console > Phone Numbers > Verified Caller IDs > add your number. On trial, you can only call numbers listed here.

### Successful test!
After fixes, the full flow worked:
1. Sent "Remind me to drink water in 2 minutes" on WhatsApp
2. Bhoolanath confirmed and set the reminder
3. 2 minutes later, phone rang with Indian English voice reading the reminder
4. WhatsApp follow-up message arrived after the call

---

## Setting Up Twilio (Detailed Guide)

### 1. Create account
Sign up at [twilio.com](https://www.twilio.com). Free trial gives $15 credit.

### 2. Get Account SID and Auth Token
- Go to the Console Dashboard (click "View account in Twilio Console" from the admin page)
- Account SID (starts with `AC`) and Auth Token are displayed
- Auth Token is hidden — click the eye icon to reveal

### 3. Get a phone number
- In Console: Phone Numbers > Manage > Buy a number
- Pick one with Voice capability
- Free trial includes one number

### 4. Set up WhatsApp Sandbox
- Go to Messaging > Try it out > Send a WhatsApp message
- Note the sandbox number (usually `+14155238886`)
- Send the join code from your WhatsApp to that number
- Go to Sandbox Settings tab
- Set "When a message comes in" to your ngrok URL + `/webhook/whatsapp`

### 5. Verify your phone for calls
- Phone Numbers > Manage > Verified Caller IDs
- Add your phone number (trial accounts can only call verified numbers)

---

## Setting Up ngrok (Exposing Localhost)

Twilio needs to reach your server over the internet. ngrok creates a tunnel from a public URL to your localhost.

### Install
Download from [ngrok.com/download](https://ngrok.com/download) and unzip. No installer needed.

### Configure
```bash
# One-time setup (replace with your auth token from ngrok dashboard)
path/to/ngrok.exe config add-authtoken YOUR_TOKEN_HERE
```

### Run
```bash
path/to/ngrok.exe http 3000
```

This gives you a URL like `https://furlable-brycen-superficially.ngrok-free.dev`. Use this as your `BASE_URL` in `.env` and in Twilio's webhook settings.

**Keep the ngrok terminal open** — closing it kills the tunnel.

---

## Behavioral Fixes & Refinements

### Problem: Claude asks for confirmation every time
When you say "remind me to call dad at 1:10 pm", Claude would reply "Should I set this?" and wait for "Yes". This is annoying on WhatsApp.

**Fix:** Updated the system prompt rule from "Always confirm before creating" to "When the message is clear, just create it immediately."

### Problem: Reschedule creates a new reminder instead of updating
After a reminder was delivered, saying "reschedule this to 1 pm" created a duplicate because Claude couldn't see completed reminders.

**Fix:** Added "RECENTLY COMPLETED REMINDERS" to the system prompt (last 5 completed) and updated the rule to explicitly say "use reschedule_reminder tool — do NOT create a new reminder."

---

## Final Project Structure

```
personal-reminder-app/
├── src/
│   ├── index.js              # Express server + scheduler start
│   ├── config.js             # Env config loader
│   ├── routes/
│   │   ├── webhook.js        # WhatsApp incoming message handler
│   │   └── voice.js          # Voice call TwiML + status
│   ├── services/
│   │   ├── claude.js         # Claude API + NLP + tools
│   │   ├── twilio.js         # WhatsApp msgs + voice calls
│   │   ├── sarvam.js         # Speech-to-text + text-to-speech
│   │   └── scheduler.js      # Cron job for due reminders
│   └── db/
│       ├── index.js          # SQLite connection
│       └── schema.sql        # Database schema
├── data/
│   └── bhoolanath.db         # SQLite database (auto-created)
├── package.json
├── .env.example
└── .gitignore
```

---

## Environment Variables Checklist

| Variable | Where to get it |
|---|---|
| `PORT` | Default: 3000 |
| `BASE_URL` | Your ngrok URL (dev) or Railway URL (prod) |
| `TWILIO_ACCOUNT_SID` | Twilio Console Dashboard |
| `TWILIO_AUTH_TOKEN` | Twilio Console Dashboard (click eye icon) |
| `TWILIO_PHONE_NUMBER` | Twilio Console > Phone Numbers |
| `TWILIO_WHATSAPP_NUMBER` | Twilio WhatsApp Sandbox (`+14155238886`) |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `SARVAM_API_KEY` | sarvam.ai dashboard |

---

## Running the App

```bash
# 1. Clone and install
git clone https://github.com/YOUR_USERNAME/personal-reminder-app.git
cd personal-reminder-app
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your API keys

# 3. Start ngrok (in a separate terminal)
ngrok http 3000
# Copy the forwarding URL into .env as BASE_URL
# Also set it in Twilio Sandbox Settings

# 4. Start the app
npm start

# 5. Send a WhatsApp message to +14155238886
# "Remind me to call mom in 5 minutes"
```

---

## Deploying to Render (Production)

Up to this point, Bhoolanath runs on your laptop with ngrok. That means if your laptop sleeps or you close the terminal, the bot stops. Deploying to Render gives you a 24/7 server with a permanent URL.

### Step 1: Create a Render account
Sign up at [render.com](https://render.com) (free tier available).

### Step 2: Create a Web Service
1. Click **"New +"** > **"Web Service"**
2. Connect your GitHub account and select the `personal-reminder-app` repo
3. Fill in these settings:

| Field | Value |
|---|---|
| **Name** | `bhoolanath` or `personal-reminder-app` |
| **Region** | Closest to India (Singapore if available) |
| **Branch** | `main` |
| **Build Command** | `npm install` |
| **Start Command** | `node src/index.js` |
| **Instance Type** | Free |

### Step 3: Add environment variables
In the **Environment** section, add these 6 variables (copy values from your `.env`):
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `TWILIO_WHATSAPP_NUMBER`
- `ANTHROPIC_API_KEY`
- `SARVAM_API_KEY`

**Skip `PORT`** — Render sets its own port automatically.
**Skip `BASE_URL` for now** — we'll add it after the first deploy.

### Step 4: Deploy
Click **Deploy**. Wait for it to finish. Render will give you a public URL like `https://personal-reminder-app.onrender.com`.

### Step 5: Set BASE_URL
Go back to **Environment** tab on Render and add:
- `BASE_URL` = `https://personal-reminder-app.onrender.com`

Render will auto-redeploy with this change.

### Step 6: Update Twilio webhook
In Twilio Console > **Messaging** > **Try it out** > **Send a WhatsApp message** > **Sandbox Settings**:
- Change "When a message comes in" from your ngrok URL to:
  ```
  https://personal-reminder-app.onrender.com/webhook/whatsapp
  ```
- Save

### Step 7: Test
Send a WhatsApp message to the sandbox number. You can now close ngrok and your local server — Bhoolanath is running 24/7 on Render!

### Viewing logs
On Render: go to your service dashboard > **Logs** tab. Shows real-time server logs just like your local terminal.

### Important: SQLite on Render free tier
Render's free tier has **ephemeral storage** — the filesystem resets on every deploy. This means your SQLite database (`bhoolanath.db`) gets wiped each time Render redeploys. For a personal reminder app this is usually fine (old reminders don't matter much), but if you need persistence, consider:
- **Render Disk** ($0.25/GB/month) — persistent storage that survives redeploys
- **Switching to a hosted database** like Turso (SQLite-compatible, free tier) or Supabase (PostgreSQL)

### Auto-deploy
Every time you `git push` to `main`, Render automatically redeploys. No manual steps needed.

---

## Key Lessons Learned

1. **Always check API error messages** — they often tell you exactly what's wrong (wrong model name, wrong speaker, etc.)
2. **ngrok free tier has quirks** — it shows a warning page that can break webhooks. Use inline responses where possible.
3. **Twilio trial has limits** — can only call verified numbers, sandbox requires join code, 24-hour message window
4. **Build incrementally** — each step was testable independently, making it easy to find bugs
5. **System prompt engineering matters** — small changes to Claude's instructions dramatically change behavior (confirmation flow, reschedule logic)
6. **Always have a fallback** — if the voice call fails, WhatsApp message ensures the user still gets reminded
7. **Git commit often** — committing after each working step means you can always roll back
8. **Deploy early** — moving from localhost to Render was straightforward because we kept the app simple (no build step, plain Node.js)
9. **Skip `PORT` on PaaS** — platforms like Render set their own port; don't hardcode it
10. **Separate dev and prod URLs** — ngrok for development, Render for production; update Twilio webhook accordingly
