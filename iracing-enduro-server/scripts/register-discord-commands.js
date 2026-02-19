// Run this once to register the /register slash command with Discord
// Usage: node scripts/register-discord-commands.js
require('dotenv').config({ path: '../.env' });
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('register')
    .setDescription('Link your Discord account to receive iRacing stint alerts via DM')
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
  try {
    console.log('Registering Discord slash commands...');

    // You need your Discord Application (Client) ID here
    // Find it at: discord.com/developers/applications → your app → General Information
    const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
    if (!CLIENT_ID) {
      console.error('Set DISCORD_CLIENT_ID in your .env file');
      process.exit(1);
    }

    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Slash commands registered globally (may take up to 1 hour to appear)');
  } catch (err) {
    console.error('Failed:', err.message);
  }
})();
