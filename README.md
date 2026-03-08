# Discord Jibble Bot

A Discord bot that integrates with the [Jibble](https://www.jibble.io/) time-tracking API. Team members can clock in, clock out, take breaks, and resume work directly from a Discord channel using slash commands — without ever opening the Jibble app.

All bot responses are **private (ephemeral)** — only the person who ran the command sees the result. When a user runs a time-tracking command, a brief public notice appears in the channel so the team stays informed.

---

## Features

- `/clockin` `/break` `/resume` `/clockout` — full time-tracking workflow with order enforcement (can't clock out while on break, can't break before clocking in, etc.)
- `/status` — see your current state and today's hours worked
- `/report` — admin-only attendance reports with analytics: attendance %, total hours, avg per day, daily log
  - Filter by month, ISO month (`2026-03`), or custom date range (`25 feb to 25 march`)
  - Team overview or individual deep-dive
- Admin-only registration: admins link Discord users to their Jibble accounts via email
- Public channel notification only for time-tracking actions by non-admins — admin actions are always silent
- Saturday counted as a working day (Mon–Sat week)

---

## Prerequisites

- **Node.js 18+**
- A **Discord bot** (see setup below)
- A **Jibble account** with admin access and API credentials

---

## 1. Create a Discord Bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → give it a name → click **Create**
3. Go to **Bot** in the left sidebar
4. Click **Reset Token** → copy the token (you'll need it for `DISCORD_BOT_TOKEN`)
5. Scroll down to **Privileged Gateway Intents** — no special intents are needed, leave them off
6. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot permissions: `Send Messages`, `Embed Links`, `Read Message History`
7. Copy the generated URL → paste in your browser → invite the bot to your server
8. In your Discord server, go to the channel you want the bot to use → right-click the channel → **Copy Channel ID** (enable Developer Mode in Discord settings first)

---

## 2. Get Jibble API Credentials

1. Log in to Jibble as an admin
2. Go to **Settings → Integrations → API**
3. Create a new API app — this gives you a **Client ID** and **Client Secret**
4. Copy both values

---

## 3. Local Setup

```bash
# Clone the repo
git clone https://github.com/Faizan5377/discord-jibble-bot.git
cd discord-jibble-bot

# Install dependencies
npm install

# Copy the example env file
cp .env.example .env
```

Edit `.env` with your credentials:

```env
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_CHANNEL_ID=your_channel_id
JIBBLE_CLIENT_ID=your_jibble_client_id
JIBBLE_CLIENT_SECRET=your_jibble_client_secret
```

```bash
# Run in development (auto-restarts on file changes)
npm run dev
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DISCORD_BOT_TOKEN` | Yes | Your Discord bot token |
| `DISCORD_CHANNEL_ID` | No | Channel ID to restrict the bot to (leave blank for all channels) |
| `JIBBLE_CLIENT_ID` | Yes | Jibble OAuth2 client ID |
| `JIBBLE_CLIENT_SECRET` | Yes | Jibble OAuth2 client secret |
| `JIBBLE_IDENTITY_URL` | No | Override Jibble identity URL (default: `https://identity.prod.jibble.io`) |
| `JIBBLE_WORKSPACE_URL` | No | Override Jibble workspace URL (default: `https://workspace.prod.jibble.io`) |
| `JIBBLE_TIMETRACKING_URL` | No | Override Jibble time-tracking URL (default: `https://time-tracking.prod.jibble.io`) |

---

## Commands

### User Commands
| Command | Description |
|---|---|
| `/clockin` | Start your work day |
| `/break` | Start a break |
| `/resume` | Return from break |
| `/clockout` | End your work day |
| `/status` | See your Jibble link and today's hours |
| `/help` | Show available commands |

**Workflow order is enforced:** `/clockin` → `/break` → `/resume` → `/clockout`. The bot blocks out-of-order actions.

### Admin Commands
| Command | Description |
|---|---|
| `/register user:@user email:their@email.com` | Link a Discord user to their Jibble account |
| `/unregister user:@user` | Remove a user's Jibble link |
| `/status user:@user` | Check another user's current status |
| `/report` | Team attendance report for the current month |
| `/report user:@user` | Individual report |
| `/report period:march` | Report for a specific month |
| `/report period:"25 feb to 25 march"` | Custom date range report |
| `/report user:@user period:march` | Combine user and period filters |

---

## Registering Team Members

Only admins can register users. Once the bot is running:

1. Make sure the team member exists in your Jibble organisation
2. An admin runs: `/register user:@theirDiscordName email:their@email.com`
3. The bot looks them up in Jibble and links the accounts
4. They can now use all time-tracking commands

---

## Deploy to Railway (Free, 24/7)

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → sign in with GitHub
3. Click **New Project** → **Deploy from GitHub repo** → select this repo
4. Go to the **Variables** tab and add all four required env variables
5. Railway builds and deploys automatically — the bot stays online 24/7

> **Note:** Railway's filesystem is ephemeral — user mappings stored in `data/jibble-bot.json` will reset on each redeploy. Re-register users with `/register` after any new deployment.

---

## Project Structure

```
src/
├── index.ts              # Entry point, Discord client, command routing
├── config.ts             # Env var loading and validation
├── commands/
│   ├── definitions.ts    # Slash command definitions (registered with Discord)
│   └── handler.ts        # All command handler logic
├── services/
│   ├── jibble.ts         # Jibble API client (auth, clock in/out, reports)
│   └── userMapping.ts    # In-memory user map backed by JSON file
├── db/
│   └── database.ts       # JSON file persistence layer
└── utils/
    └── logger.ts         # Simple timestamped logger
```
