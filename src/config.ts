import dotenv from 'dotenv';
dotenv.config();

function parseIntEnv(name: string, def: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < min || n > max) {
    throw new Error(`Invalid ${name}: "${raw}" (expected integer ${min}-${max})`);
  }
  return n;
}

function parseFloatEnv(name: string, def: number, min: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = parseFloat(raw);
  if (Number.isNaN(n) || n < min) {
    throw new Error(`Invalid ${name}: "${raw}" (expected number >= ${min})`);
  }
  return n;
}

function parseWeekdays(raw: string | undefined): number[] {
  if (!raw) return [1, 2, 3, 4, 5, 6]; // Mon-Sat (Sunday off)
  const days = raw.split(',').map(s => parseInt(s.trim(), 10));
  if (days.some(n => Number.isNaN(n) || n < 0 || n > 6) || days.length === 0) {
    throw new Error(`Invalid WORKING_WEEKDAYS: "${raw}" (expected CSV of 0-6, 0=Sun..6=Sat)`);
  }
  return Array.from(new Set(days));
}

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
  payroll: {
    cycleStartDay: parseIntEnv('SALARY_CYCLE_START_DAY', 25, 1, 28),
    expectedHoursPerDay: parseFloatEnv('EXPECTED_HOURS_PER_DAY', 8, 0),
    workingWeekdays: parseWeekdays(process.env.WORKING_WEEKDAYS),
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
