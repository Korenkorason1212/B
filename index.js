const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActivityType } = require('discord.js');

// ==================== CONFIGURATION ====================
// Replace these with your actual bot credentials
// ==================== CONFIGURATION ====================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

const LOG_CHANNEL_ID = '1508765790323871805';
const BYPASS_ROLE_ID = '1508781887705841734';
// =======================================================
// =======================================================

// Initialize Client with required intents
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers
    ] 
});

// Cooldown tracker (Key: UserID, Value: Timestamp when they can vouch again)
const vouchCooldowns = new Map();

// Define the vouch command structure
const vouchCommandData = new SlashCommandBuilder()
    .setName('vouch')
    .setDescription('Vouch for a user!')
    .addUserOption(option =>
        option.setName('target')
            .setDescription('The user you want to vouch for')
            .setRequired(true)
    )
    .addStringOption(option =>
        option.setName('reason')
            .setDescription('Why are you vouching for them?')
            .setRequired(false)
    );

// Register the slash command globally with Discord's API
const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        console.log('🔄 Syncing slash commands with Discord...');
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: [vouchCommandData.toJSON()] },
        );
        console.log('✅ Slash commands successfully registered globally!');
    } catch (error) {
        console.error('❌ Failed to register commands:', error);
    }
})();

// Main Event: Bot Ready (Sets the activity status here)
client.once('ready', () => {
    console.log(`🚀 Connected! Logged in as ${client.user.tag}`);
    
    // Sets the bot status to: Playing Buy From Tops And Bottoms Shop
    client.user.setActivity('Buy From Tops And Bottoms Shop', { type: ActivityType.Playing });
});

// Main Event: Command Handler
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'vouch') return;

    const targetUser = interaction.options.getUser('target');
    const reason = interaction.options.getString('reason') || 'No reason provided.';
    const member = interaction.member;

    // 1. Safety Checks
    if (targetUser.id === interaction.user.id) {
        return interaction.reply({ 
            content: '❌ You cannot vouch for yourself!', 
            ephemeral: true 
        });
    }

    if (targetUser.bot) {
        return interaction.reply({ 
            content: '❌ You cannot vouch for a bot!', 
            ephemeral: true 
        });
    }

    // 2. Cooldown Evaluation
    const hasBypassRole = member.roles.cache.has(BYPASS_ROLE_ID);
    const currentTime = Date.now();

    if (!hasBypassRole) {
        if (vouchCooldowns.has(interaction.user.id)) {
            const expirationTime = vouchCooldowns.get(interaction.user.id);

            if (currentTime < expirationTime) {
                const discordTimestamp = Math.floor(expirationTime / 1000);
                return interaction.reply({
                    content: `⏳ You are on cooldown! You can vouch again <t:${discordTimestamp}:R>. (Users with the special role bypass this!).`,
                    ephemeral: true
                });
            }
        }
    }

    // 3. Fetch Destination Logging Channel
    const logChannel = interaction.client.channels.cache.get(LOG_CHANNEL_ID);
    if (!logChannel) {
        return interaction.reply({ 
            content: '❌ Error: Could not find the logging channel. Check my permissions or the ID configuration.', 
            ephemeral: true 
        });
    }

    // 4. Construct Blue Vouch Embed
    const vouchEmbed = new EmbedBuilder()
        .setColor('#0099ff') // Vibrant Blue Color
        .setTitle('📥 New Vouch Registered')
        .addFields(
            { name: '👤 Sender', value: `${interaction.user} (${interaction.user.id})`, inline: true },
            { name: '🎯 Recipient', value: `${targetUser} (${targetUser.id})`, inline: true },
            { name: '📝 Details', value: `\`\`\`${reason}\`\`\`` }
        )
        .setTimestamp()
        .setFooter({ text: `Vouch System`, iconURL: interaction.guild.iconURL() });

    try {
        // Send the ping alongside the embed so the target user gets a notification
        await logChannel.send({ 
            content: `🔔 **New Vouch for:** ${targetUser}`, 
            embeds: [vouchEmbed] 
        });

        // 5. Apply Cooldown if they do not have the bypass role (24 hours)
        if (!hasBypassRole) {
            const cooldownDuration = 24 * 60 * 60 * 1000; 
            vouchCooldowns.set(interaction.user.id, currentTime + cooldownDuration);
        }

        return interaction.reply({ 
            content: `✅ Success! Your vouch for **${targetUser.username}** has been sent to <#${LOG_CHANNEL_ID}>.`, 
            ephemeral: true 
        });

    } catch (error) {
        console.error(error);
        return interaction.reply({ 
            content: '❌ Failed to process the vouch log entry.', 
            ephemeral: true 
        });
    }
});

// Log the bot in
client.login(TOKEN);