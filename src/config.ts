import dotenv from 'dotenv';
dotenv.config();

export const config = {
  discord: {
    token: process.env.DISCORD_BOT_TOKEN ?? '',
    channelIds: process.env.DISCORD_CHANNEL_ID
      ? process.env.DISCORD_CHANNEL_ID.split(',').map(id => id.trim()).filter(Boolean)
      : [],
  },
  jibble: {
    clientId: process.env.JIBBLE_CLIENT_ID ?? '',
    clientSecret: process.env.JIBBLE_CLIENT_SECRET ?? '',
    identityUrl: process.env.JIBBLE_IDENTITY_URL ?? 'https://identity.prod.jibble.io',
    workspaceUrl: process.env.JIBBLE_WORKSPACE_URL ?? 'https://workspace.prod.jibble.io',
    timeTrackingUrl: process.env.JIBBLE_TIMETRACKING_URL ?? 'https://time-tracking.prod.jibble.io',
  },
  db: {
    path: './data/jibble-bot.json',
  },
};

// Validate required config at startup
const required: Array<[string, string]> = [
  ['DISCORD_BOT_TOKEN', config.discord.token],
  ['JIBBLE_CLIENT_ID', config.jibble.clientId],
  ['JIBBLE_CLIENT_SECRET', config.jibble.clientSecret],
];

for (const [name, value] of required) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}
