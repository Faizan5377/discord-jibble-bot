import { ChatInputCommandInteraction, EmbedBuilder, ColorResolvable, PermissionsBitField } from 'discord.js';
import { jibbleService, Report } from '../services/jibble';
import { userMappingService } from '../services/userMapping';
import { logger } from '../utils/logger';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function embed(color: ColorResolvable, description: string): EmbedBuilder {
  return new EmbedBuilder().setColor(color).setDescription(description).setTimestamp();
}

function nowStr(): string {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
}

function fmtMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Period / date-range parser ───────────────────────────────────────────────

interface Period {
  startDate: string;
  endDate: string;
  label: string;
}

const MONTH_NAMES = ['january','february','march','april','may','june','july','august','september','october','november','december'];

function parseMonthName(s: string): number | null {
  const idx = MONTH_NAMES.findIndex(m => m.startsWith(s.toLowerCase()));
  return idx !== -1 ? idx + 1 : null;
}

function parseSingleDate(s: string, defaultYear: number): Date | null {
  s = s.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
  const slashFull = s.match(/^(\d{1,2})\/(\d{2})\/(\d{4})$/);
  if (slashFull) return new Date(parseInt(slashFull[3]), parseInt(slashFull[2]) - 1, parseInt(slashFull[1]));
  const slashShort = s.match(/^(\d{1,2})\/(\d{2})$/);
  if (slashShort) return new Date(defaultYear, parseInt(slashShort[2]) - 1, parseInt(slashShort[1]));
  const named = s.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/i);
  if (named) {
    const day = parseInt(named[1]);
    const month = parseMonthName(named[2]);
    if (month !== null) {
      return new Date(named[3] ? parseInt(named[3]) : defaultYear, month - 1, day);
    }
  }
  return null;
}

function parsePeriodArg(arg: string | null): Period | null {
  const today = new Date();
  const currentYear = today.getFullYear();

  if (!arg) {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return {
      startDate: toDateStr(start),
      endDate: toDateStr(end),
      label: today.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    };
  }

  const toIdx = arg.search(/\bto\b/i);
  if (toIdx !== -1) {
    const start = parseSingleDate(arg.slice(0, toIdx).trim(), currentYear);
    let end = parseSingleDate(arg.slice(toIdx + 2).trim(), currentYear);
    if (start && end) {
      if (end < start) end = parseSingleDate(arg.slice(toIdx + 2).trim(), currentYear + 1)!;
      return {
        startDate: toDateStr(start),
        endDate: toDateStr(end),
        label:
          start.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) +
          ' – ' +
          end.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }),
      };
    }
  }

  const isoMonth = arg.match(/^(\d{4})-(\d{2})$/);
  if (isoMonth) {
    const year = parseInt(isoMonth[1]);
    const month = parseInt(isoMonth[2]);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    return { startDate: toDateStr(start), endDate: toDateStr(end), label: start.toLocaleString('en-US', { month: 'long', year: 'numeric' }) };
  }

  const monthIdx = MONTH_NAMES.findIndex(m => m.startsWith(arg.toLowerCase()));
  if (monthIdx !== -1) {
    const month = monthIdx + 1;
    const year = month > today.getMonth() + 1 ? currentYear - 1 : currentYear;
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    return { startDate: toDateStr(start), endDate: toDateStr(end), label: start.toLocaleString('en-US', { month: 'long', year: 'numeric' }) };
  }

  return null;
}

// ─── Permission helpers ───────────────────────────────────────────────────────

function isAdmin(interaction: ChatInputCommandInteraction): boolean {
  const perms = interaction.member?.permissions;
  if (!perms) return false;
  return perms instanceof PermissionsBitField
    ? perms.has('Administrator')
    : new PermissionsBitField(BigInt(perms)).has('Administrator');
}

function requireMapping(interaction: ChatInputCommandInteraction) {
  const mapping = userMappingService.get(interaction.user.id);
  if (!mapping) {
    interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor('#ff6b35')
          .setTitle('Not Registered')
          .setDescription(
            "You haven't been linked to a Jibble account yet.\n\n" +
            'Ask your server administrator to register you with:\n' +
            '`/register @you your@email.com`'
          )
          .setTimestamp(),
      ],
    }).catch(() => undefined);
    return null;
  }
  return mapping;
}

// ─── User commands ────────────────────────────────────────────────────────────

export async function handleClockIn(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const mapping = requireMapping(interaction);
  if (!mapping) return;

  try {
    const state = await jibbleService.getCurrentState(mapping.jibblePersonId);
    if (state === 'clocked-in') {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor('#ff6b35').setTitle('Already Clocked In')
          .setDescription(`You are already clocked in.\n\nUse \`/break\` to take a break, or \`/clockout\` to end your day.`).setTimestamp()],
      });
      return;
    }
    if (state === 'on-break') {
      await interaction.editReply({ embeds: [embed('#ff6b35', 'You are on a break. Use `/resume` to come back first.')] });
      return;
    }
  } catch { /* let Jibble handle it */ }

  try {
    await jibbleService.clockIn(mapping.jibblePersonId);
    await interaction.editReply({ embeds: [embed('#00c853', `⏰ **${mapping.jibbleName}** clocked in at ${nowStr()}`)] });
  } catch (err: unknown) {
    await interaction.editReply({ embeds: [embed('#212121', `❌ Clock in failed: ${(err as Error).message}`)] });
  }
}

export async function handleClockOut(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const mapping = requireMapping(interaction);
  if (!mapping) return;

  try {
    const state = await jibbleService.getCurrentState(mapping.jibblePersonId);
    if (state === 'clocked-out') {
      await interaction.editReply({ embeds: [embed('#ff6b35', 'You are not clocked in. Use `/clockin` first.')] });
      return;
    }
    if (state === 'on-break') {
      await interaction.editReply({ embeds: [embed('#ff6b35', 'You are on a break. Use `/resume` first, then `/clockout`.')] });
      return;
    }
  } catch { /* let Jibble handle it */ }

  try {
    await jibbleService.clockOut(mapping.jibblePersonId);
    await interaction.editReply({ embeds: [embed('#d50000', `🛑 **${mapping.jibbleName}** clocked out at ${nowStr()}`)] });
  } catch (err: unknown) {
    await interaction.editReply({ embeds: [embed('#212121', `❌ Clock out failed: ${(err as Error).message}`)] });
  }
}

export async function handleBreak(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const mapping = requireMapping(interaction);
  if (!mapping) return;

  try {
    const state = await jibbleService.getCurrentState(mapping.jibblePersonId);
    if (state === 'clocked-out') {
      await interaction.editReply({ embeds: [embed('#ff6b35', 'You need to `/clockin` before you can take a break.')] });
      return;
    }
    if (state === 'on-break') {
      await interaction.editReply({ embeds: [embed('#ff6b35', 'You are already on a break. Use `/resume` to come back.')] });
      return;
    }
  } catch { /* let Jibble handle it */ }

  try {
    await jibbleService.startBreak(mapping.jibblePersonId);
    await interaction.editReply({ embeds: [embed('#ffd600', `☕ **${mapping.jibbleName}** started a break at ${nowStr()}`)] });
  } catch (err: unknown) {
    await interaction.editReply({ embeds: [embed('#212121', `❌ Break failed: ${(err as Error).message}`)] });
  }
}

export async function handleResume(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const mapping = requireMapping(interaction);
  if (!mapping) return;

  try {
    const state = await jibbleService.getCurrentState(mapping.jibblePersonId);
    if (state === 'clocked-out') {
      await interaction.editReply({ embeds: [embed('#ff6b35', 'You are not clocked in. Use `/clockin` to start your day.')] });
      return;
    }
    if (state === 'clocked-in') {
      await interaction.editReply({ embeds: [embed('#ff6b35', 'You are not on a break. Use `/break` first.')] });
      return;
    }
  } catch { /* let Jibble handle it */ }

  try {
    await jibbleService.endBreak(mapping.jibblePersonId);
    await interaction.editReply({ embeds: [embed('#2196f3', `🔄 **${mapping.jibbleName}** resumed work at ${nowStr()}`)] });
  } catch (err: unknown) {
    await interaction.editReply({ embeds: [embed('#212121', `❌ Resume failed: ${(err as Error).message}`)] });
  }
}

export async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const targetUser = interaction.options.getUser('user');
  if (targetUser) {
    if (!isAdmin(interaction)) {
      await interaction.editReply({ embeds: [embed('#d50000', 'Only administrators can check other users\' status.')] });
      return;
    }
    const mapping = userMappingService.get(targetUser.id);
    if (!mapping) {
      await interaction.editReply({ embeds: [embed('#ff6b35', `<@${targetUser.id}> is not registered with the bot.`)] });
      return;
    }
    await interaction.editReply({ embeds: [await buildStatusEmbed(mapping, `Status — ${mapping.jibbleName}`)] });
    return;
  }

  const mapping = requireMapping(interaction);
  if (!mapping) return;
  await interaction.editReply({ embeds: [await buildStatusEmbed(mapping, 'Your Status')] });
}

async function buildStatusEmbed(
  mapping: { jibbleName: string; jibbleEmail: string; jibblePersonId: string },
  title: string
): Promise<EmbedBuilder> {
  let todayLine = '';
  let color: ColorResolvable = '#607d8b';

  try {
    const stats = await jibbleService.getTodayStats(mapping.jibblePersonId);
    if (stats.clockIn) {
      const inStr = stats.clockIn.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const outStr = stats.clockOut
        ? stats.clockOut.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        : 'still clocked in';
      const brk = stats.breakMinutes > 0 ? ` · Break: ${fmtMinutes(stats.breakMinutes)}` : '';
      todayLine = `Clocked in at **${inStr}** → ${outStr}\nWorked today: **${fmtMinutes(stats.workedMinutes)}**${brk}`;
      color = stats.clockOut ? '#607d8b' : '#00c853';
    } else {
      todayLine = 'Not clocked in today.';
    }
  } catch {
    todayLine = 'Could not fetch today\'s activity.';
  }

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(
      { name: 'Jibble Name',  value: mapping.jibbleName,  inline: true },
      { name: 'Jibble Email', value: mapping.jibbleEmail, inline: true },
      { name: 'Today',        value: todayLine,           inline: false },
    )
    .setTimestamp();
}

// ─── Admin commands ───────────────────────────────────────────────────────────

export async function handleRegister(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  if (!isAdmin(interaction)) {
    await interaction.editReply({ embeds: [embed('#d50000', 'Only administrators can register users.')] });
    return;
  }

  const targetUser = interaction.options.getUser('user', true);
  const email = interaction.options.getString('email', true).trim();

  if (!email.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i)) {
    await interaction.editReply({ embeds: [embed('#ff6b35', `**${email}** doesn't look like a valid email address.`)] });
    return;
  }

  try {
    const person = await jibbleService.findPersonByEmail(email);
    if (!person) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor('#d50000')
            .setTitle('Email Not Found on Jibble')
            .setDescription(
              `No Jibble account found for **${email}**\n\n` +
              '**Possible reasons:**\n' +
              '• Email is misspelled — double-check it\n' +
              '• The user signed up with a different email\n' +
              '• The user has not been added to the Jibble organisation yet'
            )
            .setTimestamp(),
        ],
      });
      return;
    }

    userMappingService.register({
      discordId: targetUser.id,
      discordUsername: targetUser.username,
      jibblePersonId: person.id,
      jibbleEmail: person.email,
      jibbleName: person.name,
    });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor('#00c853')
          .setTitle('User Registered')
          .addFields(
            { name: 'Discord',      value: `<@${targetUser.id}>`, inline: true },
            { name: 'Jibble Name',  value: person.name,           inline: true },
            { name: 'Jibble Email', value: person.email,          inline: false },
          )
          .setFooter({ text: 'They can now use /clockin, /clockout, /break, /resume' })
          .setTimestamp(),
      ],
    });
  } catch (err: unknown) {
    await interaction.editReply({ embeds: [embed('#212121', `❌ Registration failed: ${(err as Error).message}`)] });
  }
}

export async function handleUnregister(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  if (!isAdmin(interaction)) {
    await interaction.editReply({ embeds: [embed('#d50000', 'Only administrators can unregister users.')] });
    return;
  }

  const targetUser = interaction.options.getUser('user', true);
  const mapping = userMappingService.get(targetUser.id);
  if (!mapping) {
    await interaction.editReply({ embeds: [embed('#555555', `<@${targetUser.id}> is not registered with the bot.`)] });
    return;
  }

  userMappingService.unregister(targetUser.id);
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor('#607d8b')
        .setTitle('User Unregistered')
        .setDescription(`<@${targetUser.id}> (**${mapping.jibbleName}**) has been unlinked from Jibble.`)
        .setTimestamp(),
    ],
  });
}

// ─── Reports ─────────────────────────────────────────────────────────────────

function buildReportEmbed(r: Report): EmbedBuilder {
  const avgMinutes = r.daysPresent > 0 ? Math.round(r.totalWorkedMinutes / r.daysPresent) : 0;
  const attendancePct = r.totalWorkingDays > 0 ? Math.round((r.daysPresent / r.totalWorkingDays) * 100) : 0;
  const filled = Math.round(attendancePct / 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

  const lines: string[] = [];
  for (const d of r.days) {
    if (!d.clockIn) continue;
    const dateStr = new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const inStr = d.clockIn.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const outStr = d.clockOut ? d.clockOut.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'no out';
    const brk = d.breakMinutes > 0 ? ` (break: ${fmtMinutes(d.breakMinutes)})` : '';
    lines.push(`\`${dateStr}\`  ${inStr} → ${outStr}  **${fmtMinutes(d.workedMinutes)}**${brk}`);
  }

  // Discord embed field limit is 1024 chars — truncate by characters, not lines
  let dailyLog = lines.join('\n');
  if (dailyLog.length > 1000) {
    let kept = 0;
    while (kept < lines.length && lines.slice(0, kept + 1).join('\n').length <= 950) kept++;
    dailyLog = lines.slice(0, kept).join('\n') + `\n…and ${lines.length - kept} more days`;
  }
  if (!dailyLog) dailyLog = 'No attendance records found.';

  return new EmbedBuilder()
    .setColor('#7289da')
    .setTitle(`Report — ${r.label}`)
    .setDescription(`**${r.personName}**`)
    .addFields(
      { name: 'Attendance', value: `${bar} **${attendancePct}%**\nPresent: **${r.daysPresent}** · Absent: **${r.daysAbsent}** · Working days: **${r.totalWorkingDays}**`, inline: false },
      { name: 'Hours', value: `Total worked: **${fmtMinutes(r.totalWorkedMinutes)}**\nTotal breaks: **${fmtMinutes(r.totalBreakMinutes)}**\nAvg per day:  **${fmtMinutes(avgMinutes)}**`, inline: false },
      { name: 'Daily Log', value: dailyLog, inline: false }
    )
    .setTimestamp();
}

export async function handleReport(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  if (!isAdmin(interaction)) {
    await interaction.editReply({ embeds: [embed('#d50000', 'Only administrators can view reports.')] });
    return;
  }

  const targetUser = interaction.options.getUser('user');
  const periodArg = interaction.options.getString('period');
  const period = parsePeriodArg(periodArg);

  if (!period) {
    await interaction.editReply({ embeds: [embed('#ff6b35', 'Invalid period. Examples: `march`, `2026-03`, `25 march to 25 april`')] });
    return;
  }

  if (targetUser) {
    // Single user report
    const mapping = userMappingService.get(targetUser.id);
    if (!mapping) {
      await interaction.editReply({ embeds: [embed('#ff6b35', `<@${targetUser.id}> has not been registered with the bot yet.`)] });
      return;
    }
    try {
      const report = await jibbleService.getReport(mapping.jibblePersonId, mapping.jibbleName, period.startDate, period.endDate, period.label);
      await interaction.editReply({ embeds: [buildReportEmbed(report)] });
    } catch (err: unknown) {
      await interaction.editReply({ embeds: [embed('#212121', `❌ Failed to fetch report: ${(err as Error).message}`)] });
    }
  } else {
    // Team report
    const allMappings = userMappingService.getAll();
    if (allMappings.length === 0) {
      await interaction.editReply({ embeds: [embed('#555555', 'No users are registered yet.')] });
      return;
    }

    const results = await Promise.allSettled(
      allMappings.map(m => jibbleService.getReport(m.jibblePersonId, m.jibbleName, period.startDate, period.endDate, period.label))
    );

    const rows: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        const rep = r.value;
        const pct = rep.totalWorkingDays > 0 ? Math.round((rep.daysPresent / rep.totalWorkingDays) * 100) : 0;
        rows.push(`**${rep.personName}**\n  Present: ${rep.daysPresent}/${rep.totalWorkingDays} days (${pct}%) · Worked: ${fmtMinutes(rep.totalWorkedMinutes)}`);
      } else {
        const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
        rows.push(`**${allMappings[i].jibbleName}** — ❌ ${reason}`);
      }
    }

    try {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor('#7289da')
            .setTitle(`Team Report — ${period.label}`)
            .setDescription(rows.join('\n\n') || 'No data.')
            .setFooter({ text: `${allMappings.length} registered members · Use /report user:@someone for detail` })
            .setTimestamp(),
        ],
      });
    } catch (err: unknown) {
      logger.error('Failed to send team report embed:', err);
      await interaction.editReply({ embeds: [embed('#212121', `❌ Failed to display report: ${(err as Error).message}`)] });
    }
  }
}

// ─── Help ─────────────────────────────────────────────────────────────────────

export async function handleHelp(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const admin = isAdmin(interaction);
  const mapping = userMappingService.get(interaction.user.id);

  const now = new Date();
  const thisMonth = now.toLocaleString('en-US', { month: 'long' }).toLowerCase();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleString('en-US', { month: 'long' }).toLowerCase();

  if (admin) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor('#f0a500')
          .setTitle('Jibble Bot — Admin Panel')
          .setDescription('> You have full administrator access.')
          .addFields(
            { name: 'Member Management', value: '`/register user:@user email:email` — Link a user to Jibble\n`/unregister user:@user` — Remove a user\'s link', inline: false },
            { name: 'Reports', value: `\`/report\` — Team report (current month)\n\`/report user:@user\` — One person's report\n\`/report period:${thisMonth}\` — Specific month\n\`/report period:"25 ${prevMonth} to 25 ${thisMonth}"\` — Custom range\n\`/report user:@user period:${thisMonth}\` — Combine both`, inline: false },
            { name: 'Status', value: '`/status` — Your own status\n`/status user:@user` — Another user\'s status', inline: false },
            { name: 'Time Tracking (your own)', value: '`/clockin` · `/break` · `/resume` · `/clockout`', inline: false },
            { name: 'Workflow Order', value: '`/clockin`  →  `/break`  →  `/resume`  →  `/clockout`\nThe bot blocks out-of-order commands.', inline: false },
            { name: 'Notes', value: '• All responses are private — only you can see them\n• A user must exist in Jibble before you can register them here', inline: false },
          )
          .setFooter({ text: 'Jibble Time Tracking Bot  •  Admin View' })
          .setTimestamp(),
      ],
    });
  } else {
    const statusLine = mapping
      ? `Linked as **${mapping.jibbleName}** (${mapping.jibbleEmail})`
      : 'You are **not registered yet** — ask an admin to register you.';

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor('#5865f2')
          .setTitle('Jibble Time Tracking Bot')
          .setDescription(`> ${statusLine}`)
          .addFields(
            { name: 'Commands', value: '`/clockin` — Start your work day\n`/break` — Take a break\n`/resume` — Return from break\n`/clockout` — End your work day\n`/status` — See your link and today\'s hours', inline: false },
            { name: 'Correct Order', value: '`/clockin`  →  `/break`  →  `/resume`  →  `/clockout`\nThe bot blocks you if you go out of order.', inline: false },
            { name: 'Notes', value: '• All responses are private — only you can see them\n• Contact your admin for registration or account issues', inline: false },
          )
          .setFooter({ text: 'Jibble Time Tracking Bot  •  All responses are only visible to you' })
          .setTimestamp(),
      ],
    });
  }
}
