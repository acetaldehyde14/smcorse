const axios = require('axios');
const { query } = require('../config/database');

// ── Telegram Bot ───────────────────────────────────────────────
let telegram = null;

function initTelegram() {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.warn('[Notifications] No TELEGRAM_BOT_TOKEN set — Telegram disabled');
    return null;
  }

  const { Telegraf } = require('telegraf');
  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

  // /start command: user DMs bot → saves their chat_id linked to their account
  bot.start(async (ctx) => {
    const chatId = String(ctx.chat.id);
    const tgUsername = ctx.from.username;
    try {
      const result = await query(
        `UPDATE users SET telegram_chat_id = $1
         WHERE LOWER(iracing_name) = LOWER($2) OR LOWER(username) = LOWER($2)
         RETURNING username`,
        [chatId, tgUsername || '']
      );
      if (result.rowCount > 0) {
        ctx.reply(
          `Linked! Hey ${result.rows[0].username}, you'll now get iRacing stint & fuel alerts here.`
        );
      } else {
        ctx.reply(
          `Couldn't auto-link your account. Ask your team admin to set your Telegram chat ID.\n\nYour chat ID is: <code>${chatId}</code>`,
          { parse_mode: 'HTML' }
        );
      }
    } catch (e) {
      console.error('[Telegram /start]', e.message);
      ctx.reply(`Your chat ID is: ${chatId} — give this to your team admin.`);
    }
  });

  bot.launch()
    .then(() => console.log('[Telegram] Bot launched'))
    .catch((e) => console.error('[Telegram] Launch failed:', e.message));

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  return bot;
}

// ── Discord Bot ────────────────────────────────────────────────
let discordBot = null;

function initDiscord() {
  if (!process.env.DISCORD_BOT_TOKEN) {
    console.warn('[Notifications] No DISCORD_BOT_TOKEN set — Discord Bot DMs disabled');
    return null;
  }

  const { Client, GatewayIntentBits } = require('discord.js');
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  });

  client.once('ready', () => {
    console.log(`[Discord] Bot logged in as ${client.user.tag}`);
  });

  // Slash command: /register — saves their Discord user ID
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'register') return;

    const discordUserId = interaction.user.id;
    const siteUsername = interaction.options.getString('username');

    try {
      const result = await query(
        `UPDATE users SET discord_user_id = $1
         WHERE LOWER(username) = LOWER($2)
         RETURNING username`,
        [discordUserId, siteUsername]
      );
      if (result.rowCount > 0) {
        await interaction.reply({
          content: `✅ Linked! You'll now receive iRacing alerts via DM, ${result.rows[0].username}.`,
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: `❌ No account found with username \`${siteUsername}\`. Check your smcorse.com username and try again.`,
          ephemeral: true,
        });
      }
    } catch (e) {
      console.error('[Discord /register]', e.message);
      await interaction.reply({ content: 'Error registering. Try again later.', ephemeral: true });
    }
  });

  client.login(process.env.DISCORD_BOT_TOKEN).catch((e) =>
    console.error('[Discord] Login failed:', e.message)
  );

  return client;
}

// ── Send Functions ─────────────────────────────────────────────

async function sendTelegram(chatId, message) {
  if (!telegram || !chatId) return;
  try {
    await telegram.telegram.sendMessage(chatId, message, { parse_mode: 'HTML' });
  } catch (e) {
    console.error('[Telegram send]', e.message);
  }
}

async function sendDiscordDM(discordUserId, embed) {
  if (!discordBot || !discordUserId || !discordBot.isReady()) return;
  try {
    const user = await discordBot.users.fetch(discordUserId);
    const dm = await user.createDM();
    await dm.send({ embeds: [embed] });
  } catch (e) {
    console.error('[Discord DM]', e.message);
  }
}

async function sendDiscordWebhook(webhookUrl, payload) {
  if (!webhookUrl) return;
  // payload can be { embeds: [...] } or { content, embeds: [...] }
  const body = Array.isArray(payload?.embeds) ? payload : { embeds: [payload] };
  try {
    await axios.post(webhookUrl, body, { timeout: 5000 });
  } catch (e) {
    console.error('[Discord Webhook]', e.message);
  }
}

async function sendDiscordTeamChannel(teamId, payload = {}) {
  if (!discordBot || !discordBot.isReady()) {
    console.warn(`[Discord Team Channel] Bot not ready for team ${teamId || 'unknown'}`);
    return false;
  }
  if (!teamId) {
    console.warn('[Discord Team Channel] Missing teamId');
    return false;
  }

  let team;
  try {
    const result = await query(
      'SELECT id, name, discord_channel_id, discord_role_id FROM teams WHERE id = $1',
      [teamId]
    );
    team = result.rows[0];
  } catch (e) {
    console.error(`[Discord Team Channel] Failed team lookup for team ${teamId}:`, e.message);
    return false;
  }

  if (!team) {
    console.warn(`[Discord Team Channel] Missing team ${teamId}`);
    return false;
  }
  if (!team.discord_channel_id) {
    console.log(`[Discord Team Channel] No discord_channel_id configured for team ${teamId} (${team.name})`);
    return false;
  }

  let channel;
  try {
    channel = await discordBot.channels.fetch(team.discord_channel_id);
  } catch (e) {
    console.error(`[Discord Team Channel] Failed fetch for channel ${team.discord_channel_id} team ${teamId}:`, e.message);
    return false;
  }

  if (!channel) {
    console.warn(`[Discord Team Channel] Missing channel ${team.discord_channel_id} for team ${teamId}`);
    return false;
  }
  if (typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
    console.warn(`[Discord Team Channel] Channel ${team.discord_channel_id} for team ${teamId} is not text-based`);
    return false;
  }

  const roleId = team.discord_role_id || null;
  const contentParts = [];
  if (roleId) contentParts.push(`<@&${roleId}>`);
  if (payload.content) contentParts.push(payload.content);

  const userIds = Array.isArray(payload.userIds)
    ? payload.userIds.map(String).filter(Boolean)
    : [];

  try {
    await channel.send({
      content: contentParts.join(' ').trim() || undefined,
      embeds: Array.isArray(payload.embeds) ? payload.embeds : undefined,
      allowedMentions: {
        roles: roleId ? [roleId] : [],
        users: userIds,
      },
    });
    console.log(`[Discord Team Channel] Sent alert to team ${teamId} channel ${team.discord_channel_id}`);
    return true;
  } catch (e) {
    console.error(`[Discord Team Channel] Send failed for team ${teamId} channel ${team.discord_channel_id}:`, e.message);
    return false;
  }
}

async function sendTeamDiscordAlert(teamId, payload, fallbackPayload = payload) {
  if (teamId) {
    const sent = await sendDiscordTeamChannel(teamId, payload);
    if (sent) return true;
  } else {
    console.log('[Discord Team Channel] No teamId supplied; falling back to DISCORD_TEAM_WEBHOOK');
  }

  await sendDiscordWebhook(process.env.DISCORD_TEAM_WEBHOOK, fallbackPayload);
  return false;
}

function getTeamIdFromStintPlanInfo(stintPlanInfo) {
  return stintPlanInfo?.teamId || stintPlanInfo?.team_id || null;
}

async function getTeamIdForRace(raceId) {
  if (!raceId) return null;
  try {
    const result = await query(
      `SELECT (sps.config->>'team_id')::int AS team_id
       FROM races r
       JOIN stint_planner_sessions sps ON sps.id = r.active_stint_session_id
       WHERE r.id = $1
         AND sps.config ? 'team_id'
         AND sps.config->>'team_id' ~ '^[0-9]+$'
       LIMIT 1`,
      [raceId]
    );
    return result.rows[0]?.team_id || null;
  } catch (e) {
    console.error(`[Discord Team Channel] Failed to resolve team for race ${raceId}:`, e.message);
    return null;
  }
}

// Send to all channels the user has configured
async function notifyUser(user, telegramMsg, discordEmbed) {
  if (!user) return;
  const tasks = [];
  if (user.telegram_chat_id) tasks.push(sendTelegram(user.telegram_chat_id, telegramMsg));
  if (user.discord_user_id)  tasks.push(sendDiscordDM(user.discord_user_id, discordEmbed));
  if (user.discord_webhook)  tasks.push(sendDiscordWebhook(user.discord_webhook, discordEmbed));
  await Promise.allSettled(tasks);
}

// ── Notification Events ────────────────────────────────────────

// stintPlanInfo = { deviationMins, nextNextDriverName, plannedDurationMins, currentIndex, totalBlocks } | null
async function notifyDriverChange(driverName, driverUser, nextDriver, stintPlanInfo, teamId = null) {
  const resolvedTeamId = teamId || getTeamIdFromStintPlanInfo(stintPlanInfo);
  const timestamp = new Date().toISOString();

  // Build plan deviation text
  let planLine = '';
  if (stintPlanInfo) {
    const { deviationMins, nextNextDriverName, plannedDurationMins } = stintPlanInfo;
    if (deviationMins !== null) {
      const absMin = Math.abs(deviationMins);
      if (absMin <= 2) {
        planLine = '\n⏱ **On schedule**';
      } else if (deviationMins > 0) {
        planLine = `\n⏱ **${absMin} min early** vs plan`;
      } else {
        planLine = `\n⏱ **${absMin} min late** vs plan`;
      }
    }
    if (plannedDurationMins) {
      planLine += `\n🕐 Planned stint: **${plannedDurationMins} min**`;
    }
    if (nextNextDriverName) {
      planLine += `\n👤 After this: **${nextNextDriverName}**`;
    }
  }

  // 1. Team channel webhook
  await sendTeamDiscordAlert(resolvedTeamId, {
    embeds: [{
      title: 'Driver Change',
      description: `**${driverName}** is now in the car.${planLine}`,
      color: 0x1e90ff,
      timestamp,
      footer: { text: 'SM CORSE Enduro Monitor' },
    }],
  }, {
    title: '🏎️ Driver Change',
    description: `**${driverName}** is now in the car.${planLine}`,
    color: 0x1e90ff,
    timestamp,
    footer: { text: 'SM CORSE Enduro Monitor' },
  });

  // 2. Current driver — confirm they're in
  if (driverUser) {
    let dmPlanLine = '';
    if (stintPlanInfo?.plannedDurationMins) {
      dmPlanLine = `\nPlanned stint: <b>${stintPlanInfo.plannedDurationMins} min</b>`;
    }
    await notifyUser(
      driverUser,
      `<b>You're in the car, ${driverUser.username}!</b>\nYour stint has started. Drive fast, stay clean!${dmPlanLine}`,
      {
        title: '🟢 Your Stint Has Started',
        description: `You are now in the car. Good luck!${stintPlanInfo?.plannedDurationMins ? `\nPlanned duration: **${stintPlanInfo.plannedDurationMins} min**` : ''}`,
        color: 0x00cc44,
        timestamp,
        footer: { text: 'SM CORSE Enduro Monitor' },
      }
    );
  }

  // 3. Next driver — get ready
  if (nextDriver) {
    await notifyUser(
      nextDriver,
      `<b>Heads up, ${nextDriver.username}!</b>\nYou're next in the stint roster. Start getting ready!`,
      {
        title: 'You\'re Next — Get Ready!',
        description: 'You\'re next in the stint roster. Start getting strapped in!',
        color: 0xffa500,
        timestamp,
        footer: { text: 'SM CORSE Enduro Monitor' },
      }
    );
  }
}

async function notifyLowFuel(minsRemaining, fuelLevel, nextDriver, teamId = null) {
  const mins = Math.round(minsRemaining);
  const timestamp = new Date().toISOString();

  // 1. Team channel
  await sendTeamDiscordAlert(teamId, {
    embeds: [{
      title: 'Low Fuel Warning',
      description: `~**${mins} minutes** of fuel remaining (${fuelLevel.toFixed(1)}L)\nNext driver: prepare for your stint!`,
      color: 0xff4444,
      timestamp,
      footer: { text: 'SM CORSE Enduro Monitor' },
    }],
  }, {
    title: 'Low Fuel Warning',
    description: `~**${mins} minutes** of fuel remaining (${fuelLevel.toFixed(1)}L)\nNext driver: prepare for your stint!`,
    color: 0xff4444,
    timestamp,
    footer: { text: 'SM CORSE Enduro Monitor' },
  });

  // 2. Next driver direct alert
  if (nextDriver) {
    await notifyUser(
      nextDriver,
      `<b>Low Fuel Alert — Get Ready, ${nextDriver.username}!</b>\n~${mins} minutes of fuel left (${fuelLevel.toFixed(1)}L).\nYour stint is coming up very soon!`,
      {
        title: 'Low Fuel — Your Stint Is Coming Up!',
        description: `~**${mins} minutes** of fuel remaining (${fuelLevel.toFixed(1)}L).\nGet strapped in — you're on soon!`,
        color: 0xff4444,
        timestamp,
        footer: { text: 'SM CORSE Enduro Monitor' },
      }
    );
  }
}

// ── Upcoming Stint Alert ───────────────────────────────────────

async function notifyUpcomingStint(driverName, driverUser, minsUntil, teamId = null) {
  const timestamp   = new Date().toISOString();
  const mins        = Math.round(minsUntil);
  const discordUserId = driverUser?.discord_user_id ? String(driverUser.discord_user_id) : null;

  // 1. Team channel embed
  await sendTeamDiscordAlert(teamId, {
    embeds: [{
      title: 'Upcoming Stint',
      description: `**${driverName}** stint starting in **${mins} minutes**. Get ready!`,
      color: 0xffa500,
      timestamp,
      footer: { text: 'SM CORSE Enduro Monitor' },
    }],
    // Ping the driver in the channel message if we know their Discord ID
    ...(discordUserId
      ? { content: `<@${discordUserId}> your stint starts in **${mins} minutes** — get strapped in!` }
      : {}),
    userIds: discordUserId ? [discordUserId] : [],
  }, {
    embeds: [{
      title: 'Upcoming Stint',
      description: `**${driverName}** stint starting in **${mins} minutes**. Get ready!`,
      color: 0xffa500,
      timestamp,
      footer: { text: 'SM CORSE Enduro Monitor' },
    }],
    ...(discordUserId
      ? { content: `<@${discordUserId}> your stint starts in **${mins} minutes** - get strapped in!` }
      : {}),
  });

  // 2. DM the driver directly
  if (driverUser?.discord_user_id) {
    await sendDiscordDM(driverUser.discord_user_id, {
      title: '⏰ Your Stint is Coming Up!',
      description: `Your stint starts in **${mins} minutes**. Start getting ready now!`,
      color: 0xffa500,
      timestamp,
      footer: { text: 'SM CORSE Enduro Monitor' },
    });
  }

  // 3. Telegram DM if linked
  if (driverUser?.telegram_chat_id) {
    await sendTelegram(
      driverUser.telegram_chat_id,
      `<b>⏰ Upcoming Stint — ${driverName}</b>\nYour stint starts in <b>${mins} minutes</b>. Get ready!`
    );
  }
}

// ── Background checker: fires 20-min and 10-min alerts ──────────

// Each threshold has its own flag stored on the plan block.
const ALERT_THRESHOLDS = [
  { mins: 20, flag: 'pre_stint_notified_20' },
  { mins: 10, flag: 'pre_stint_notified_10' },
];
const CHECK_INTERVAL_MS = 60 * 1000; // every 1 minute
let _alertInterval = null;

async function checkUpcomingStints() {
  try {
    const racesR = await query(
      `SELECT r.*, rs.current_stint_index
       FROM races r
       LEFT JOIN race_state rs ON rs.race_id = r.id
       WHERE r.is_active = TRUE AND r.active_stint_session_id IS NOT NULL`
    );

    for (const race of racesR.rows) {
      if (!race.started_at) continue;

      const sessionR = await query(
        'SELECT id, plan FROM stint_planner_sessions WHERE id = $1',
        [race.active_stint_session_id]
      );
      if (!sessionR.rows[0]) continue;

      const session      = sessionR.rows[0];
      const teamId       = session.config?.team_id || null;
      const plan         = Array.isArray(session.plan) ? [...session.plan].map(b => ({ ...b })) : [];
      const currentIndex = race.current_stint_index || 0;
      const raceStartMs  = new Date(race.started_at).getTime();
      const now          = Date.now();
      let planDirty      = false;

      for (let i = currentIndex + 1; i < plan.length; i++) {
        const block = plan[i];
        if (block.actual_start_at) continue; // already driving

        const startBlock = block.startBlock ?? (block.start_hour != null
          ? Math.round(block.start_hour * 60 / 45) : null);
        if (startBlock == null) continue;

        const plannedStartMs = raceStartMs + startBlock * 45 * 60 * 1000;
        const minsUntilStart = (plannedStartMs - now) / 60000;

        for (const { mins, flag } of ALERT_THRESHOLDS) {
          if (block[flag]) continue; // already fired for this threshold
          // Fire within a ±2 minute window around the threshold
          if (minsUntilStart >= mins - 2 && minsUntilStart <= mins + 2) {
            const driverName = (block.driver_name || block.driver || '').trim();
            if (!driverName) continue;

            const userR = await query(
              `SELECT * FROM users
               WHERE LOWER(iracing_name) = LOWER($1) OR LOWER(username) = LOWER($1)
               LIMIT 1`,
              [driverName]
            );
            const driverUser = userR.rows[0] || null;

            console.log(`[StintAlert] ${mins}m alert — ${driverName} (race ${race.id})`);
            await notifyUpcomingStint(driverName, driverUser, minsUntilStart, teamId);

            plan[i] = { ...plan[i], [flag]: true };
            planDirty = true;
          }
        }
      }

      if (planDirty) {
        await query(
          'UPDATE stint_planner_sessions SET plan = $1::jsonb, updated_at = NOW() WHERE id = $2',
          [JSON.stringify(plan), session.id]
        );
      }
    }
  } catch (e) {
    console.error('[StintAlert] check error:', e.message);
  }
}

function startStintAlerts() {
  if (_alertInterval) return;
  _alertInterval = setInterval(checkUpcomingStints, CHECK_INTERVAL_MS);
  console.log('[StintAlert] Background stint alerts started (20m + 10m)');
}

function stopStintAlerts() {
  if (_alertInterval) { clearInterval(_alertInterval); _alertInterval = null; }
}

async function notifyBoxedAndOut(driverName, stintPlanInfo, teamId = null) {
  const resolvedTeamId = teamId || getTeamIdFromStintPlanInfo(stintPlanInfo);
  const timestamp = new Date().toISOString();

  const stintNum = stintPlanInfo?.currentIndex != null ? stintPlanInfo.currentIndex + 1 : '?';
  let extraLines = `\n📋 Now on **Stint ${stintNum}**`;
  if (stintPlanInfo?.nextNextDriverName) {
    extraLines += `\n👤 Next up: **${stintPlanInfo.nextNextDriverName}**`;
  }
  if (stintPlanInfo?.plannedDurationMins) {
    extraLines += `\n🕐 Planned stint: **${stintPlanInfo.plannedDurationMins} min**`;
  }

  await sendTeamDiscordAlert(resolvedTeamId, {
    embeds: [{
      title: 'Pit Stop - Same Driver Back Out',
      description: `**${driverName}** has pitted and gone back out.${extraLines}`,
      color: 0xffa500,
      timestamp,
      footer: { text: 'SM CORSE Enduro Monitor' },
    }],
  }, {
    title: '🔄 Pit Stop — Same Driver Back Out',
    description: `**${driverName}** has pitted and gone back out.${extraLines}`,
    color: 0xffa500,
    timestamp,
    footer: { text: 'SM CORSE Enduro Monitor' },
  });
}

// ── Graceful shutdown helper ───────────────────────────────────
function shutdownBots() {
  if (telegram) {
    try { telegram.stop('shutdown'); } catch (e) { /* ignore */ }
  }
  if (discordBot) {
    try { discordBot.destroy(); } catch (e) { /* ignore */ }
  }
}

module.exports = {
  initTelegram: () => { telegram = initTelegram(); },
  initDiscord:  () => { discordBot = initDiscord(); },
  shutdownBots,
  startStintAlerts,
  stopStintAlerts,
  notifyDriverChange,
  notifyBoxedAndOut,
  notifyLowFuel,
  sendTelegram,
  sendDiscordWebhook,
  sendDiscordTeamChannel,
  getTeamIdForRace,
};
