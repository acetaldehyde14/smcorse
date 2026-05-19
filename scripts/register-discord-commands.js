require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('register')
    .setDescription('Register your Discord account with SM CORSE')
    .addStringOption((option) =>
      option
        .setName('username')
        .setDescription('Your SM CORSE username')
        .setRequired(true)
    )
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands }
    );
    console.log('✓ /register command registered globally');
  } catch (err) {
    console.error('Failed to register commands:', err.message);
    process.exit(1);
  }
})();
