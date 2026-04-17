require('dotenv').config();
const { REST, Routes } = require('discord.js');

const commands = [
  {
    name: 'register',
    description: 'Link your Discord account to receive iRacing stint & fuel alerts',
    options: [
      {
        name: 'username',
        description: 'Your smcorse.com username',
        type: 3, // STRING
        required: true,
      },
    ],
  },
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
