const { 
    Client, 
    GatewayIntentBits, 
    ActivityType, 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    REST, 
    Routes,
    EmbedBuilder 
} = require('discord.js');
const fs = require('fs'); // Added to read and write files locally
const path = require('path');

// 1. Initialize Client with message content intent enabled to scan chat text
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,    // Required to read messages for triggers
        GatewayIntentBits.MessageContent    // Required to scan message text
    ]
});

const TOKEN = process.env.DISCORD_TOKEN; // Safe! No actual token is typed here.
const CLIENT_ID = '1510232536876585070';
// Separate channel IDs for each command
const STRIKE_LOG_CHANNEL_ID = '1439406646932541480'; 
const PROMO_LOG_CHANNEL_ID = '1515941950530785302'; 

// Path where the triggers will be saved on your system
const TRIGGERS_FILE = path.join(__dirname, 'triggers.json');
let customTriggers = new Map();

// Load saved triggers from file when the bot starts up
function loadTriggers() {
    try {
        if (fs.existsSync(TRIGGERS_FILE)) {
            const data = fs.readFileSync(TRIGGERS_FILE, 'utf8');
            const parsed = JSON.parse(data);
            customTriggers = new Map(Object.entries(parsed));
            console.log(`Loaded ${customTriggers.size} saved triggers successfully.`);
        } else {
            // Create an empty file if it doesn't exist yet
            fs.writeFileSync(TRIGGERS_FILE, JSON.stringify({}), 'utf8');
            customTriggers = new Map();
        }
    } catch (error) {
        console.error('Error loading triggers from file:', error);
        customTriggers = new Map();
    }
}

// Save the triggers map back to the local file
function saveTriggers() {
    try {
        const obj = Object.fromEntries(customTriggers);
        fs.writeFileSync(TRIGGERS_FILE, JSON.stringify(obj, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving triggers to file:', error);
    }
}

// Load files immediately on startup
loadTriggers();

// 2. Set Activity on Ready and Register Slash Commands
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // Set status to: Playing THM On Top
    client.user.setActivity('THM On Top', { type: ActivityType.Playing });

    // Define /strike command
    const strikeCommand = new SlashCommandBuilder()
        .setName('strike')
        .setDescription('Issues a strike to a user.')
        .addUserOption(option => option.setName('user').setDescription('The user to strike').setRequired(true))
        .addRoleOption(option => option.setName('role').setDescription('The punishment role to give').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the strike').setRequired(false))
        .addStringOption(option => option.setName('proof').setDescription('Proof link/evidence').setRequired(false));

    // Define /promotion command
    const promotionCommand = new SlashCommandBuilder()
        .setName('promotion')
        .setDescription('Promotes a user.')
        .addUserOption(option => option.setName('user').setDescription('The user to promote').setRequired(true))
        .addRoleOption(option => option.setName('role').setDescription('The new role to grant').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the promotion').setRequired(false));

    // Define /trigger command
    const triggerCommand = new SlashCommandBuilder()
        .setName('trigger')
        .setDescription('Sets up an automated word trigger.')
        .addStringOption(option => option.setName('trigger').setDescription('The exact phrase to look out for').setRequired(true))
        .addStringOption(option => option.setName('response').setDescription('The message the bot should reply with').setRequired(true));

    // Deploy slash commands globally
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: [strikeCommand.toJSON(), promotionCommand.toJSON(), triggerCommand.toJSON()] },
        );
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
});

// 3. Scan general chat messages for automated custom triggers
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    // Convert message content to lower case for flexible keyword matching
    const standardMessage = message.content.toLowerCase().trim();

    if (customTriggers.has(standardMessage)) {
        const matchingReply = customTriggers.get(standardMessage);
        await message.reply(matchingReply).catch(err => console.error('Failed to send trigger reply:', err));
    }
});

// 4. Handle Slash Command Interactions
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // Safely defer the reply to handle network delays
    try {
        await interaction.deferReply({ ephemeral: true });
    } catch (error) {
        console.error('Failed to defer interaction:', error);
    }

    const { commandName, options, member, guild, user } = interaction;

    // Helper function to safely send feedback back to the HR user
    const safeReply = async (content) => {
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content });
            } else {
                await interaction.reply({ content, ephemeral: true });
            }
        } catch (err) {
            console.error('Could not send response to user:', err.message);
        }
    };

    // --- HANDLE /TRIGGER COMMAND ---
    if (commandName === 'trigger') {
        if (!member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return safeReply('❌ You do not have HR permissions to use this command.');
        }

        const triggerPhrase = options.getString('trigger').toLowerCase().trim();
        const responsePhrase = options.getString('response');

        // Save into internal cache map
        customTriggers.set(triggerPhrase, responsePhrase);
        
        // Permanent backup: Write them immediately to triggers.json
        saveTriggers();

        return safeReply(`✅ Trigger updated! Whenever anyone types \`${triggerPhrase}\`, I will reply with: "${responsePhrase}". It is saved permanently.`);
    }

    // --- RULE CHECKER FOR MODERATION COMMANDS (STRIKE / PROMOTION) ---
    const targetUser = options.getUser('user');
    const targetRole = options.getRole('role');
    const reason = options.getString('reason') || 'No reason provided';
    
    // Check 1: HR permission verification (Manage Roles)
    if (!member.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return safeReply('❌ You do not have HR permissions to use this command.');
    }

    // Check 2: Self-targeting block
    if (targetUser.id === user.id) {
        return safeReply(`❌ You cannot use /${commandName} on yourself!`);
    }

    // Fetch target member details safely
    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
        return safeReply('❌ Error: That user is not currently in this server.');
    }

    // Check 3: Hierarchy enforcement (Cannot target equal or higher roles than executor)
    const executorHighestRole = member.roles.highest;
    const targetHighestRole = targetMember.roles.highest;

    if (targetHighestRole.position >= executorHighestRole.position) {
        return safeReply(`❌ You cannot use /${commandName} on someone with an equal or higher role than you. Only lower users.`);
    }


    // --- HANDLE /STRIKE COMMAND ---
    if (commandName === 'strike') {
        const logChannel = guild.channels.cache.get(STRIKE_LOG_CHANNEL_ID);
        if (!logChannel) {
            return safeReply(`❌ Error: Strike logging channel \`${STRIKE_LOG_CHANNEL_ID}\` not found.`);
        }

        const proof = options.getString('proof') || 'No proof provided';

        // Add the strike/punishment role
        try {
            await targetMember.roles.add(targetRole);
        } catch (error) {
            return safeReply(`❌ Failed to give the role. Make sure my bot's role is ranked **above** <@&${targetRole.id}> in your Server Settings!`);
        }

        const logEmbed = new EmbedBuilder()
            .setColor(0xFF0000) // Red
            .setTitle('Strike')
            .setDescription(
                `**Discord:** <@${targetUser.id}>\n` +
                `**Reason:** ${reason}\n` +
                `**Punishment:** <@&${targetRole.id}>\n` +
                `**Approved by:** <@${user.id}>\n` +
                `**Proof:** ${proof}`
            )
            .setTimestamp();

        try {
            await logChannel.send({ 
                content: `⚠️ <@${targetUser.id}>, you have received a strike.`, 
                embeds: [logEmbed] 
            });
        } catch (err) {
            console.error('Failed to send log message:', err);
        }

        return safeReply(`✅ Successfully struck <@${targetUser.id}> and assigned the <@&${targetRole.id}> role.`);
    }


    // --- HANDLE /PROMOTION COMMAND ---
    if (commandName === 'promotion') {
        const logChannel = guild.channels.cache.get(PROMO_LOG_CHANNEL_ID);
        if (!logChannel) {
            return safeReply(`❌ Error: Promotion logging channel \`${PROMO_LOG_CHANNEL_ID}\` not found.`);
        }
        
        // Automatically add the new promotion role to the target user
        try {
            await targetMember.roles.add(targetRole);
        } catch (error) {
            return safeReply(`❌ Failed to add the promotion role. Make sure my bot's role is ranked **above** <@&${targetRole.id}> in your Server Settings!`);
        }

        const logEmbed = new EmbedBuilder()
            .setColor(0x2ECC71) // Light Green
            .setTitle('Promotion')
            .setDescription(
                `**Discord:** <@${targetUser.id}>\n` +
                `**Reason:** ${reason}\n` + 
                `**Approved by:** <@${user.id}>`
            )
            .setTimestamp();

        try {
            await logChannel.send({ 
                content: `🎉 Congratulations <@${targetUser.id}>, you have been promoted to <@&${targetRole.id}>!`, 
                embeds: [logEmbed] 
            });
        } catch (err) {
            console.error('Failed to send log message:', err);
        }

        return safeReply(`✅ Successfully promoted <@${targetUser.id}> to the <@&${targetRole.id}> role. Log sent to channel.`);
    }
});

// Log the bot into Discord
client.login('');