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
    const discordUsername = interaction.user.username;

    try {
      const result = await query(
        `UPDATE users SET discord_user_id = $1
         WHERE LOWER(username) = LOWER($2)
         RETURNING username`,
        [discordUserId, discordUsername]
      );
      if (result.rowCount > 0) {
        await interaction.reply({
          content: 'Registered! You\'ll receive iRacing alerts via DM.',
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: `Couldn't find your account. Make sure your Discord username matches your app username.\nYour Discord ID: \`${discordUserId}\``,
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

async function sendDiscordWebhook(webhookUrl, embed) {
  if (!webhookUrl) return;
  try {
    await axios.post(webhookUrl, { embeds: [embed] }, { timeout: 5000 });
  } catch (e) {
    console.error('[Discord Webhook]', e.message);
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

async function notifyDriverChange(driverName, driverUser, nextDriver) {
  const teamWebhook = process.env.DISCORD_TEAM_WEBHOOK;
  const timestamp = new Date().toISOString();

  // 1. Team channel webhook
  await sendDiscordWebhook(teamWebhook, {
    title: 'Driver Change',
    description: `**${driverName}** is now in the car.`,
    color: 0x1e90ff,
    timestamp,
    footer: { text: 'SM CORSE Enduro Monitor' },
  });

  // 2. Current driver — confirm they're in
  if (driverUser) {
    await notifyUser(
      driverUser,
      `<b>You're in the car, ${driverUser.username}!</b>\nYour stint has started. Drive fast, stay clean!`,
      {
        title: 'Your Stint Has Started',
        description: 'You are now in the car. Good luck!',
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

async function notifyLowFuel(minsRemaining, fuelLevel, nextDriver) {
  const mins = Math.round(minsRemaining);
  const teamWebhook = process.env.DISCORD_TEAM_WEBHOOK;
  const timestamp = new Date().toISOString();

  // 1. Team channel
  await sendDiscordWebhook(teamWebhook, {
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
  notifyDriverChange,
  notifyLowFuel,
  sendTelegram,
  sendDiscordWebhook,
};
