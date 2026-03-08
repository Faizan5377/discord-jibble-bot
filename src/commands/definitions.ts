import { SlashCommandBuilder } from 'discord.js';

const _now = new Date();
const _thisMonth = _now.toLocaleString('en-US', { month: 'long' }).toLowerCase();
const _prevMonth = new Date(_now.getFullYear(), _now.getMonth() - 1, 1).toLocaleString('en-US', { month: 'long' }).toLowerCase();

export const COMMAND_DEFS = [
  new SlashCommandBuilder()
    .setName('clockin')
    .setDescription('Clock in to Jibble and start your work day'),

  new SlashCommandBuilder()
    .setName('clockout')
    .setDescription('Clock out of Jibble and end your work day'),

  new SlashCommandBuilder()
    .setName('break')
    .setDescription('Start a break (pause the timer)'),

  new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Return from a break (resume the timer)'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check your Jibble status and today\'s hours')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('[Admin] Check another user\'s status')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('register')
    .setDescription('[Admin] Link a Discord user to their Jibble account')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The Discord user to register')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('email')
        .setDescription('Their Jibble email address')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('unregister')
    .setDescription('[Admin] Remove a user\'s Jibble link')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The Discord user to unregister')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('report')
    .setDescription('[Admin] View an attendance report')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Specific user — leave empty for full team report')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('period')
        .setDescription(`Period: "${_thisMonth}", "2026-03", "25 ${_prevMonth} to 25 ${_thisMonth}" (default: current month)`)
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show available commands'),
];
