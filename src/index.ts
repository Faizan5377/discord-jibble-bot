import { Client, GatewayIntentBits, Events, REST, Routes, PermissionsBitField } from 'discord.js';
import { createServer } from 'http';
import { config } from './config';
import { initDatabase, closeDatabase } from './db/database';
import { userMappingService } from './services/userMapping';
import { COMMAND_DEFS } from './commands/definitions';
import {
  handleClockIn,
  handleClockOut,
  handleBreak,
  handleResume,
  handleStatus,
  handleRegister,
  handleUnregister,
  handleReport,
  handleHelp,
} from './commands/handler';
import { logger } from './utils/logger';

// Keep-alive HTTP server — required by Render, pinged by UptimeRobot to prevent sleep
const PORT = process.env.PORT || 3000;
createServer((_, res) => {
  res.writeHead(200);
  res.end('OK');
}).listen(PORT, () => {
  logger.info(`Health check server listening on port ${PORT}`);
});

async function registerCommands(clientId: string): Promise<void> {
  const rest = new REST().setToken(config.discord.token);
  const body = COMMAND_DEFS.map(c => c.toJSON());

  // Get all guilds the bot is in and register per-guild (instant update)
  const guildsRes = await rest.get(Routes.userGuilds()) as Array<{ id: string; name: string }>;
  for (const guild of guildsRes) {
    await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body });
    logger.info(`Slash commands registered for guild: ${guild.name}`);
  }
}

async function main(): Promise<void> {
  initDatabase();
  userMappingService.loadAll();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
    ],
  });

  client.once(Events.ClientReady, async (c) => {
    logger.info(`Bot online: ${c.user.tag}`);
    logger.info(`Connected guilds: ${c.guilds.cache.map(g => g.name).join(', ')}`);
    logger.info(`Loaded user mappings: ${userMappingService.count()}`);

    try {
      await registerCommands(c.user.id);
      logger.info('All slash commands registered');
    } catch (err) {
      logger.error('Failed to register slash commands:', err);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // Channel restriction
    if (config.discord.channelIds.length > 0 && !config.discord.channelIds.includes(interaction.channelId)) {
      await interaction.reply({ content: 'This bot is not active in this channel.', ephemeral: true });
      return;
    }

    // Public notification — only broadcast the four time-tracking actions.
    // Admin commands and everything else stay silent.
    const BROADCAST_COMMANDS = new Set(['clockin', 'clockout', 'break', 'resume']);
    const memberPerms = interaction.member?.permissions;
    const memberIsAdmin = memberPerms instanceof PermissionsBitField
      ? memberPerms.has('Administrator')
      : memberPerms ? new PermissionsBitField(BigInt(memberPerms as string)).has('Administrator') : false;

    if (!memberIsAdmin && BROADCAST_COMMANDS.has(interaction.commandName)) {
      (interaction.channel as { send?: Function })?.send?.({
        content: `> **${interaction.user.username}** used \`/${interaction.commandName}\``,
        allowedMentions: { parse: [] },
      })?.catch(() => undefined);
    }

    logger.debug(`[${interaction.user.username}] /${interaction.commandName}`);

    try {
      switch (interaction.commandName) {
        case 'clockin':    return await handleClockIn(interaction);
        case 'clockout':   return await handleClockOut(interaction);
        case 'break':      return await handleBreak(interaction);
        case 'resume':     return await handleResume(interaction);
        case 'status':     return await handleStatus(interaction);
        case 'register':   return await handleRegister(interaction);
        case 'unregister': return await handleUnregister(interaction);
        case 'report':     return await handleReport(interaction);
        case 'help':       return await handleHelp(interaction);
      }
    } catch (err: unknown) {
      logger.error(`Error handling /${interaction.commandName}:`, err);
      const msg = { embeds: [{ color: 0x212121, description: '❌ An unexpected error occurred. Please try again.' }] };
      if (interaction.deferred) {
        await interaction.editReply(msg).catch(() => undefined);
      } else {
        await interaction.reply({ ...msg, ephemeral: true }).catch(() => undefined);
      }
    }
  });

  const shutdown = (): void => {
    logger.info('Shutting down...');
    closeDatabase();
    client.destroy();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info('Connecting to Discord...');
  await client.login(config.discord.token);
}

main().catch((err: unknown) => {
  logger.error('Fatal error during startup:', err);
  process.exit(1);
});
