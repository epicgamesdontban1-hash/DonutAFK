require('dotenv').config();
// ============================================================================
// DOGGO - Minecraft Discord Bot
// ============================================================================

const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const { StartupLogger } = require('./utils');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    discord: {
        token: process.env.DISCORD_BOT_TOKEN,
        channelId: process.env.DISCORD_CHANNEL_ID
    },
    minecraft: {
        host: 'donutsmp.net',
        port: 25565,
        version: '1.21.4',
        auth: 'microsoft'
    },
    webServer: {
        port: process.env.PORT || 3000,
        host: '0.0.0.0'
    }
};

// ============================================================================
// MAIN BOT CLASS
// ============================================================================

class MinecraftDiscordBot {
    constructor() {
        this.discordClient = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages
            ]
        });
        this.minecraftBot = null;
        this.controlMessage = null;
        this.isConnected = false;
        this.isConnecting = false;
        this.authUrl = null;
        this.userCode = null;
        this.shouldJoin = false;
        this.originalConsoleLog = null;
        this.originalStdoutWrite = null;
        this.authMessageSent = false;
        this.authCheckTimeout = null;
        this.lastAuthUser = null;
        this.authInteraction = null;
        this.originalStderrWrite = null;
        this.authCheckInterval = null;

        // Enhanced features
        this.currentWorld = 'Unknown';
        this.currentCoords = { x: 0, y: 0, z: 0 };
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10000;
        this.reconnectDelay = 15000;
        this.statusUpdateInterval = null;

        // Web server properties
        this.app = null;
        this.server = null;

        // Scoreboard properties
        this.lastScoreboard = null;
        this.scoreboardUpdateInterval = null;

        // Safety features
        this.safetyConfig = {
            enabled: true,
            proximityRadius: 50,
            minHealth: 10,
            alertCooldown: 30000,
            autoDisconnectOnThreat: true,
            autoDisconnectHealth: 6
        };
        this.nearbyPlayers = new Map();
        this.lastHealthAlert = 0;
        this.lastProximityAlert = 0;
        this.currentHealth = 20;
        this.lastHealth = 20;
        this.activeThreat = null;
        this.lastSafetyDisconnect = null;
        
        // Whitelist/Blacklist system
        this.trustedPlayers = new Set(process.env.TRUSTED_PLAYERS?.split(',').filter(p => p.trim()) || []);
        this.blockedPlayers = new Set(process.env.BLOCKED_PLAYERS?.split(',').filter(p => p.trim()) || []);

        this.setupDiscordEvents();
        this.setupSlashCommands();
    }

    // ========================================================================
    // STARTUP & INITIALIZATION
    // ========================================================================

    async start() {
        const services = [];
        
        try {
            await this.discordClient.login(CONFIG.discord.token);
            services.push({ 
                name: 'Discord Bot', 
                status: true, 
                details: this.discordClient.user?.tag 
            });

            // Clear activity when offline/standby
            this.clearDiscordActivity();

            this.statusUpdateInterval = setInterval(() => {
                if (this.isConnected && this.minecraftBot) {
                    this.updatePositionInfo();
                    this.updateEmbed();
                    this.updateDiscordActivity();
                }
            }, 30000);

        } catch (error) {
            services.push({ 
                name: 'Discord Bot', 
                status: false, 
                details: error.message 
            });
        }

        try {
            await this.startWebServer();
            services.push({ 
                name: 'Web Server', 
                status: true, 
                details: `http://${CONFIG.webServer.host}:${CONFIG.webServer.port}` 
            });
        } catch (error) {
            services.push({ 
                name: 'Web Server', 
                status: false, 
                details: error.message 
            });
        }

        services.push({ 
            name: 'Minecraft Bot', 
            status: true, 
            details: 'Ready (awaiting connection)' 
        });

        StartupLogger.showStatus(services);

        const allOnline = services.every(s => s.status);
        if (!allOnline) {
            throw new Error('Some services failed to start');
        }
    }

    async startWebServer() {
        this.app = express();
    
        this.app.use(express.json());
        this.app.use(express.static('public'));
        this.setupWebRoutes();
        this.server = http.createServer(this.app);

        return new Promise((resolve, reject) => {
            this.server.on('error', (error) => {
                reject(error);
            });

            this.server.listen(CONFIG.webServer.port, CONFIG.webServer.host, () => {
                console.log(`Server listening on port ${CONFIG.webServer.port}`);
                resolve();
            });
        });
    }

    // ========================================================================
    // WEB SERVER ROUTES
    // ========================================================================

    setupWebRoutes() {
        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                minecraft: {
                    connected: this.isConnected,
                    username: this.minecraftBot?.username || null,
                    world: this.currentWorld,
                    coordinates: this.currentCoords
                },
                discord: {
                    connected: this.discordClient.readyTimestamp !== null,
                    username: this.discordClient.user?.tag || null
                }
            });
        });

        // Bot status endpoint
        this.app.get('/status', (req, res) => {
            const nearbyPlayersList = [];
            if (this.isConnected && this.minecraftBot && this.minecraftBot.players) {
                const myPos = this.minecraftBot.entity?.position;
                if (myPos) {
                    for (const [username, player] of Object.entries(this.minecraftBot.players)) {
                        if (username === this.minecraftBot.username) continue;
                        if (!player.entity || !player.entity.position) continue;
                        
                        const distance = myPos.distanceTo(player.entity.position);
                        if (distance <= this.safetyConfig.proximityRadius) {
                            nearbyPlayersList.push({
                                username,
                                distance: Math.round(distance)
                            });
                        }
                    }
                }
            }

            res.json({
                minecraft: {
                    connected: this.isConnected,
                    shouldJoin: this.shouldJoin,
                    username: this.minecraftBot?.username || null,
                    server: `${CONFIG.minecraft.host}:${CONFIG.minecraft.port}`,
                    version: CONFIG.minecraft.version,
                    world: this.currentWorld,
                    coordinates: this.currentCoords,
                    health: this.currentHealth,
                    reconnectAttempts: this.reconnectAttempts,
                    maxReconnectAttempts: this.maxReconnectAttempts,
                    authRequired: !!(this.authUrl && this.userCode)
                },
                discord: {
                    connected: this.discordClient.readyTimestamp !== null,
                    username: this.discordClient.user?.tag || null,
                    guildCount: this.discordClient.guilds.cache.size
                },
                safety: {
                    enabled: this.safetyConfig.enabled,
                    proximityRadius: this.safetyConfig.proximityRadius,
                    minHealth: this.safetyConfig.minHealth,
                    autoDisconnectHealth: this.safetyConfig.autoDisconnectHealth,
                    autoDisconnectOnThreat: this.safetyConfig.autoDisconnectOnThreat,
                    trustedCount: this.trustedPlayers.size,
                    blockedCount: this.blockedPlayers.size,
                    trustedPlayers: Array.from(this.trustedPlayers),
                    blockedPlayers: Array.from(this.blockedPlayers),
                    nearbyPlayers: nearbyPlayersList,
                    activeThreat: this.activeThreat || null,
                    lastDisconnect: this.lastSafetyDisconnect || null
                },
                uptime: process.uptime(),
                memory: process.memoryUsage()
            });
        });

        // Control endpoints
        this.app.post('/connect', async (req, res) => {
            if (this.isConnected) {
                return res.json({ success: false, message: 'Bot already connected' });
            }

            this.shouldJoin = true;
            this.reconnectAttempts = 0;
            await this.connectToMinecraft();
            
            res.json({ success: true, message: 'Connection initiated' });
        });

        this.app.post('/disconnect', async (req, res) => {
            this.shouldJoin = false;
            this.reconnectAttempts = 0;
            
            if (this.minecraftBot) {
                this.minecraftBot.quit();
                this.minecraftBot = null;
            }
            
            this.isConnected = false;
            this.clearDiscordActivity();
            await this.updateEmbed();
            res.json({ success: true, message: 'Bot disconnected' });
        });

        // Send chat message endpoint
        this.app.post('/chat', (req, res) => {
            const { message } = req.body;
            
            if (!this.isConnected || !this.minecraftBot) {
                return res.json({ success: false, message: 'Bot not connected' });
            }
            
            if (!message || typeof message !== 'string') {
                return res.json({ success: false, message: 'Invalid message' });
            }

            this.minecraftBot.chat(message);
            res.json({ success: true, message: 'Message sent' });
        });

        // Root endpoint - serve the HTML file
        this.app.get('/', (req, res, next) => {
            next();
        });

        // API info endpoint
        this.app.get('/api', (req, res) => {
            res.json({
                name: 'Minecraft Discord Bot API',
                version: '1.0.0',
                endpoints: {
                    'GET /': 'Web dashboard',
                    'GET /api': 'This endpoint',
                    'GET /health': 'Health check',
                    'GET /status': 'Detailed bot status',
                    'POST /connect': 'Connect to Minecraft server',
                    'POST /disconnect': 'Disconnect from Minecraft server',
                    'POST /chat': 'Send chat message (requires {message: "text"})'
                },
                minecraft: {
                    server: `${CONFIG.minecraft.host}:${CONFIG.minecraft.port}`,
                    version: CONFIG.minecraft.version,
                    connected: this.isConnected
                }
            });
        });

        // Error handling middleware
        this.app.use((error, req, res, next) => {
            console.error('Web server error:', error);
            res.status(500).json({
                success: false,
                message: 'Internal server error',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        });

        // 404 handler
        this.app.use((req, res) => {
            res.status(404).json({
                success: false,
                message: 'Endpoint not found',
                availableEndpoints: ['/', '/api', '/health', '/status', '/connect', '/disconnect', '/chat']
            });
        });
    }

    // ========================================================================
    // DISCORD EVENT HANDLERS
    // ========================================================================

    setupDiscordEvents() {
        this.discordClient.once('clientReady', async () => {
            await this.registerSlashCommands();
            await this.setupControlMessage();
        });

        this.discordClient.on('interactionCreate', async (interaction) => {
            if (!interaction.isButton()) return;
            if (interaction.message.id !== this.controlMessage?.id) return;

            if (interaction.customId === 'connect') {
                this.shouldJoin = true;
                this.lastAuthUser = interaction.user;
                this.authInteraction = interaction;
                this.reconnectAttempts = 0;

                const authEmbed = new EmbedBuilder()
                    .setTitle('🔐 Microsoft Authentication Required')
                    .setDescription('Please authenticate to connect the Minecraft bot.')
                    .addFields(
                        { name: '⏳ Status', value: 'Connecting to Minecraft server...', inline: false }
                    )
                    .setColor('#ff9900')
                    .setTimestamp();

                await interaction.reply({ 
                    embeds: [authEmbed], 
                    flags: [MessageFlags.Ephemeral]
                });

                this.updateDiscordActivity();

                await this.connectToMinecraft();

            } else if (interaction.customId === 'disconnect') {
                this.shouldJoin = false;
                this.reconnectAttempts = 0;
                this.authInteraction = null;
                if (this.minecraftBot) {
                    this.minecraftBot.quit();
                    this.minecraftBot = null;
                }
                this.isConnected = false;
                this.clearDiscordActivity();
                await this.updateEmbed();
                
                await interaction.reply({ 
                    content: '✅ Bot disconnected from Minecraft server!', 
                    flags: [MessageFlags.Ephemeral]
                });
            }
        });

        // Handle slash commands
        this.discordClient.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand()) return;

            // Check if command is used in the correct channel
            if (interaction.channelId !== CONFIG.discord.channelId) {
                await interaction.reply({ 
                    content: '❌ This bot can only be used in the designated channel!', 
                    flags: [MessageFlags.Ephemeral]
                });
                return;
            }

            try {
                await this.handleSlashCommand(interaction);
            } catch (error) {
                console.error('Error handling slash command:', error);
                const errorMessage = '❌ There was an error while executing this command!';
                
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: errorMessage, flags: [MessageFlags.Ephemeral] });
                } else {
                    await interaction.reply({ content: errorMessage, flags: [MessageFlags.Ephemeral] });
                }
            }
        });
    }

    async setupControlMessage() {
        const channel = await this.discordClient.channels.fetch(CONFIG.discord.channelId);
        if (!channel) {
            console.error('Control channel not found!');
            return;
        }

        const embed = this.createEmbed();
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('connect')
                    .setLabel('Connect')
                    .setEmoji('✅')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('disconnect')
                    .setLabel('Disconnect')
                    .setEmoji('❌')
                    .setStyle(ButtonStyle.Danger)
            );

        this.controlMessage = await channel.send({ 
            embeds: [embed],
            components: [row]
        });
    }

    createEmbed() {
        const statusColor = this.isConnected ? '#00ff00' : this.shouldJoin ? '#ff9900' : '#ff0000';
        const embed = new EmbedBuilder()
            .setTitle('[<:shard:1449402378175381525>] DonutAFK')
            .setColor(statusColor)
            .addFields(
                { name: '<:donut:1449408560034480319> Server', value: `\`${CONFIG.minecraft.host}\``, inline: true },
                { name: '🔗 Status', value: this.getStatusText(), inline: true },
                { name: '🛡️ Safety', value: this.safetyConfig.enabled ? (this.isConnected ? '✅ Active' : '❌ Inactive') : '⏸️ Disabled', inline: true }
            );

        if (this.isConnected && this.minecraftBot) {
            embed.addFields(
                { name: '👤 Player', value: `\`${this.minecraftBot.username}\``, inline: true },
                { name: '🌍 World', value: `\`${this.currentWorld}\``, inline: true },
                { name: '<:mcheart:1449409243479412786> Health', value: `\`${this.currentHealth}/20\``, inline: true },
                { name: '📍 Position', value: `\`${Math.round(this.currentCoords.x)}, ${Math.round(this.currentCoords.y)}, ${Math.round(this.currentCoords.z)}\``, inline: false }
            );
        }

        if (this.reconnectAttempts > 0 && this.shouldJoin) {
            embed.addFields({
                name: '🔄 Reconnecting',
                value: `${this.reconnectAttempts}/${this.maxReconnectAttempts}`,
                inline: true
            });
        }

        embed.setTimestamp()
            .setFooter({ text: 'Use buttons below to control the bot' });

        if (this.authUrl && this.userCode) {
            embed.addFields({
                name: '🔑 Auth Required',
                value: `[Click here](${this.authUrl}) | Code: \`${this.userCode}\``,
                inline: false
            });
        }

        return embed;
    }

    getStatusText() {
        if (this.authUrl && this.userCode) {
            return '⏳ Waiting for Microsoft authentication...';
        }
        if (this.isConnected && this.minecraftBot) {
            return `✅ Connected as ${this.minecraftBot.username}`;
        }
        if (this.shouldJoin && !this.isConnected) {
            if (this.reconnectAttempts > 0) {
                return `🔄 Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`;
            }
            return '⏳ Connecting...';
        }
        return '❌ Disconnected';
    }

    updatePositionInfo() {
        if (this.minecraftBot && this.minecraftBot.entity && this.minecraftBot.entity.position) {
            this.currentCoords = {
                x: this.minecraftBot.entity.position.x,
                y: this.minecraftBot.entity.position.y,
                z: this.minecraftBot.entity.position.z
            };
        }
    }

    clearDiscordActivity() {
        if (!this.discordClient || !this.discordClient.user) return;
        
        try {
            this.discordClient.user.setActivity(null);
            this.discordClient.user.setPresence({ activities: [], status: 'online' });
        } catch (error) {
            console.error('Failed to clear Discord activity:', error);
        }
    }

    updateDiscordActivity() {
        if (!this.discordClient || !this.discordClient.user) return;

        try {
            const { ActivityType } = require('discord.js');
            
            if (this.isConnected && this.minecraftBot) {
                // Only show activity when connected
                const safetyIndicator = this.safetyConfig.enabled ? '[Safe] ' : '';
                const status = `${safetyIndicator}AFK on ${CONFIG.minecraft.host}`;
                this.discordClient.user.setActivity(status, { type: ActivityType.Playing });
            } else if (this.shouldJoin) {
                // Show connecting status
                if (this.authUrl && this.userCode) {
                    this.discordClient.user.setActivity('Waiting for auth...', { type: ActivityType.Watching });
                } else {
                    this.discordClient.user.setActivity('Connecting to server...', { type: ActivityType.Watching });
                }
            } else {
                // Clear activity when not connected and not trying to connect
                this.clearDiscordActivity();
            }
        } catch (error) {
            console.error('Failed to update Discord activity:', error);
        }
    }

    // ========================================================================
    // SAFETY METHODS
    // ========================================================================

    async sendSafetyAlert(title, description, color = '#ff0000', isUrgent = false) {
        try {
            if (!this.lastAuthUser) {
                console.log('No authenticated user to send safety alert to');
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(description)
                .setColor(color)
                .addFields(
                    { name: '📍 Location', value: `\`X: ${Math.round(this.currentCoords.x)}, Y: ${Math.round(this.currentCoords.y)}, Z: ${Math.round(this.currentCoords.z)}\``, inline: true },
                    { name: '🌍 World', value: `\`${this.currentWorld}\``, inline: true },
                    { name: '❤️ Health', value: `\`${this.currentHealth}/20\``, inline: true },
                    { name: '⏰ Time', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: false }
                )
                .setTimestamp()
                .setFooter({ text: 'DonutAFK Safety System' });

            const messageContent = isUrgent ? '🚨 **URGENT SAFETY ALERT** 🚨' : '⚠️ **Safety Alert**';
            
            await this.lastAuthUser.send({ 
                content: messageContent, 
                embeds: [embed] 
            });
            
        } catch (error) {
            try {
                const channel = await this.discordClient.channels.fetch(CONFIG.discord.channelId);
                if (channel) {
                    await channel.send({ 
                        content: `⚠️ Failed to DM ${this.lastAuthUser?.tag || 'user'} - Safety Alert: **${title}**\n${description}` 
                    });
                }
            } catch (fallbackError) {
                console.error('Failed to send safety alert:', fallbackError);
            }
        }
    }

    checkPlayerProximity() {
        if (!this.safetyConfig.enabled || !this.minecraftBot || !this.minecraftBot.players) return;
        if (!this.minecraftBot.entity || !this.minecraftBot.entity.position) return;

        const now = Date.now();
        if (now - this.lastProximityAlert < this.safetyConfig.alertCooldown) return;

        const myPos = this.minecraftBot.entity.position;
        const nearbyPlayers = [];
        const threats = [];

        // Check if bot is in spawn area (X and Z between -100 and 100)
        const isInSpawnArea = Math.abs(myPos.x) <= 100 && Math.abs(myPos.z) <= 100;

        for (const [username, player] of Object.entries(this.minecraftBot.players)) {
            if (!this.minecraftBot || username === this.minecraftBot.username) continue;
            if (!player.entity || !player.entity.position) continue;

            const distance = myPos.distanceTo(player.entity.position);
            if (distance <= this.safetyConfig.proximityRadius) {
                const playerInfo = { username, distance: Math.round(distance) };
                nearbyPlayers.push(playerInfo);
                
                // Check if player is a threat (not trusted and close)
                if (!this.trustedPlayers.has(username) && distance <= 20) {
                    threats.push(playerInfo);
                }
            }
        }

        // Update active threat status
        if (threats.length > 0) {
            this.activeThreat = `${threats.length} untrusted player(s) nearby: ${threats.map(t => t.username).join(', ')}`;
        } else {
            this.activeThreat = null;
        }

        if (nearbyPlayers.length > 0) {
            this.lastProximityAlert = now;
            const playerList = nearbyPlayers.map(p => {
                const isTrusted = this.trustedPlayers.has(p.username) ? '✅' : '⚠️';
                const isBlocked = this.blockedPlayers.has(p.username) ? '🚫' : '';
                return `${isTrusted}${isBlocked} **${p.username}** (${p.distance}m)`;
            }).join(', ');
            
            // If in spawn area, send restart alert instead of disconnecting
            if (isInSpawnArea && threats.length > 0) {
                this.sendSafetyAlert(
                    '🔄 Server Restart Detected',
                    `**Player(s) detected at spawn (likely server restart):**\n${playerList}\n\n**Location:** Spawn area (X: ${Math.round(myPos.x)}, Z: ${Math.round(myPos.z)})\n**Action:** No disconnect (spawn area protection active)`,
                    '#00bfff',
                    false
                );
                return;
            }
            
            // Auto-disconnect if threatened by unknown players (outside spawn)
            if (this.safetyConfig.autoDisconnectOnThreat && threats.length > 0) {
                const threatList = threats.map(p => `${p.username} (${p.distance}m)`).join(', ');
                
                // Record the safety disconnect
                this.lastSafetyDisconnect = {
                    time: Date.now(),
                    reason: `Untrusted player(s) detected: ${threatList}`,
                    type: 'threat',
                    players: threats.map(t => t.username)
                };
                
                this.sendSafetyAlert(
                    '🚨 THREAT DETECTED - AUTO DISCONNECT',
                    `**Untrusted player(s) detected within 20 blocks:**\n${threatList}\n\n**Action:** Bot automatically disconnected for safety!`,
                    '#ff0000',
                    true
                );
                
                setTimeout(() => {
                    this.shouldJoin = false;
                    if (this.minecraftBot) {
                        this.minecraftBot.quit();
                    }
                }, 1000);
                return;
            }
            
            this.sendSafetyAlert(
                '⚠️ Player Proximity Alert',
                `**${nearbyPlayers.length} player(s) detected within ${this.safetyConfig.proximityRadius} blocks:**\n${playerList}`,
                '#ff9900',
                true
            );
        }
    }

    async checkHealth() {
        if (!this.safetyConfig.enabled || !this.minecraftBot || this.minecraftBot.health === undefined) return;

        this.lastHealth = this.currentHealth;
        this.currentHealth = this.minecraftBot.health;

        // Check for health decrease (taking damage)
        if (this.currentHealth < this.lastHealth) {
            const damage = this.lastHealth - this.currentHealth;
            
            // Auto-disconnect if health drops below critical threshold
            if (this.currentHealth <= this.safetyConfig.autoDisconnectHealth) {
                // Record the safety disconnect
                this.lastSafetyDisconnect = {
                    time: Date.now(),
                    reason: `Critical health: ${this.currentHealth}/20 HP (took ${damage} damage)`,
                    type: 'health',
                    health: this.currentHealth
                };
                
                this.sendSafetyAlert(
                    '🚨 CRITICAL HEALTH - AUTO DISCONNECT',
                    `**You took ${damage} damage! Health: ${this.currentHealth}/20**\n\n**Action:** Bot automatically disconnected for safety!`,
                    '#8B0000',
                    true
                );
                
                setTimeout(() => {
                    this.shouldJoin = false;
                    if (this.minecraftBot) {
                        this.minecraftBot.quit();
                    }
                }, 500);
                return;
            }
            
            this.sendSafetyAlert(
                '🩸 Damage Taken',
                `**You took ${damage} damage!**\nHealth decreased from ${this.lastHealth} to ${this.currentHealth}`,
                '#ff0000',
                true
            );
        }

        // Check for low health warning
        const now = Date.now();
        if (this.currentHealth <= this.safetyConfig.minHealth && 
            now - this.lastHealthAlert > this.safetyConfig.alertCooldown) {
            
            this.lastHealthAlert = now;
            this.sendSafetyAlert(
                '💀 Critical Health Alert',
                `**DANGER: Health is critically low at ${this.currentHealth}/20!**\nConsider disconnecting immediately!`,
                '#8B0000',
                true
            );
        }
    }

    // ========================================================================
    // MINECRAFT CONNECTION
    // ========================================================================

    async attemptReconnect() {
        if (!this.shouldJoin) {
            return;
        }

        if (this.isConnecting) {
            return;
        }

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.shouldJoin = false;
            this.clearDiscordActivity();
            await this.updateEmbed();
            return;
        }

        this.reconnectAttempts++;

        await this.updateEmbed();

        const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5);

        setTimeout(async () => {
            if (this.shouldJoin && !this.isConnected && !this.isConnecting) {
                await this.connectToMinecraft();
            }
        }, delay);
    }

    async connectToMinecraft() {
        if (this.isConnecting) {
            return;
        }

        if (this.minecraftBot) {
            this.minecraftBot.quit();
        }

        try {
            this.isConnecting = true;
            await this.updateEmbed();

            this.setupConsoleCapture();

            this.minecraftBot = mineflayer.createBot({
                host: CONFIG.minecraft.host,
                port: CONFIG.minecraft.port,
                version: CONFIG.minecraft.version,
                auth: CONFIG.minecraft.auth
            });

            this.setupMinecraftEvents();

            this.authCheckTimeout = setTimeout(() => {
                // Silent auth check
            }, 5000);

        } catch (error) {
            this.isConnecting = false;
            if (this.shouldJoin) {
                await this.attemptReconnect();
            } else {
                this.clearDiscordActivity();
                await this.updateEmbed();
            }
        }
    }

    setupConsoleCapture() {
        if (!this.originalStderrWrite) {
            this.originalStderrWrite = process.stderr.write;
            process.stderr.write = (chunk, encoding, callback) => {
                const message = chunk.toString();

                if (message.includes('microsoft.com/link') && message.includes('use the code')) {
                    this.extractAuthDetails(message);
                } else if (message.includes('Chunk size') || message.includes('partial packet')) {
                    return true;
                }

                return this.originalStderrWrite.call(process.stderr, chunk, encoding, callback);
            };
        }

        if (!this.originalStdoutWrite) {
            this.originalStdoutWrite = process.stdout.write;
            process.stdout.write = (chunk, encoding, callback) => {
                const message = chunk.toString();

                if (message.includes('microsoft.com/link') && message.includes('use the code')) {
                    this.extractAuthDetails(message);
                } else if (message.includes('Chunk size') || message.includes('partial packet')) {
                    return true;
                }

                return this.originalStdoutWrite.call(process.stdout, chunk, encoding, callback);
            };
        }
    }

    async forceCheckAuthCode() {
        return;
    }

    setupMinecraftEvents() {
        this.minecraftBot.on('login', async () => {
            this.isConnected = true;
            this.isConnecting = false;
            this.authUrl = null;
            this.userCode = null;
            this.authMessageSent = false;
            this.reconnectAttempts = 0;
            this.activeThreat = null;

            if (this.authInteraction) {
                try {
                    const successEmbed = new EmbedBuilder()
                        .setTitle('✅ Authentication Successful')
                        .setDescription(`Connected to Minecraft server as **${this.minecraftBot.username}**!`)
                        .setColor('#00ff00')
                        .setTimestamp();

                    await this.authInteraction.editReply({ 
                        embeds: [successEmbed]
                    });
                    
                    this.authInteraction = null;
                } catch (error) {
                    // Silent error
                }
            }

            if (this.minecraftBot && this.minecraftBot.game && this.minecraftBot.game.dimension) {
                this.currentWorld = this.minecraftBot.game.dimension;
            }

            if (this.authCheckTimeout) {
                clearTimeout(this.authCheckTimeout);
            }
            if (this.authCheckInterval) {
                clearInterval(this.authCheckInterval);
                this.authCheckInterval = null;
            }

            if (this.authMessage) {
                try {
                    await this.authMessage.delete();
                    this.authMessage = null;
                } catch (error) {
                    // Silent error
                }
            }

            this.updateDiscordActivity();
            await this.updateEmbed();
        });

        this.minecraftBot.on('spawn', async () => {
            this.updatePositionInfo();

            if (this.minecraftBot && this.minecraftBot.game && this.minecraftBot.game.dimension) {
                this.currentWorld = this.minecraftBot.game.dimension;
            }

            this.currentHealth = this.minecraftBot.health || 20;
            this.lastHealth = this.currentHealth;

            this.updateDiscordActivity();

            setTimeout(() => {
                if (this.minecraftBot) {
                    this.minecraftBot.chat('/tpa doggomc');
                }
            }, 5000);

            await this.updateEmbed();
        });

        this.minecraftBot.on('move', () => {
            this.updatePositionInfo();
            this.checkPlayerProximity();
        });

        this.minecraftBot.on('respawn', () => {
            if (this.minecraftBot && this.minecraftBot.game && this.minecraftBot.game.dimension) {
                this.currentWorld = this.minecraftBot.game.dimension;
                this.updateEmbed();
            }
        });

        this.minecraftBot.on('end', async (reason) => {
            this.isConnected = false;
            this.isConnecting = false;
            this.minecraftBot = null;
            this.currentWorld = 'Unknown';
            this.currentCoords = { x: 0, y: 0, z: 0 };
            this.activeThreat = null;

            if (this.shouldJoin) {
                this.updateDiscordActivity();
            } else {
                this.clearDiscordActivity();
            }
            await this.updateEmbed();

            if (this.shouldJoin) {
                await this.attemptReconnect();
            }
        });

        this.minecraftBot.on('error', async (error) => {
            this.isConnected = false;
            this.isConnecting = false;
            this.currentWorld = 'Unknown';
            this.currentCoords = { x: 0, y: 0, z: 0 };

            await this.updateEmbed();

            if (this.shouldJoin) {
                await this.attemptReconnect();
            } else {
                this.clearDiscordActivity();
            }
        });

        this.minecraftBot.on('kicked', async (reason) => {
            this.isConnected = false;
            this.isConnecting = false;
            this.minecraftBot = null;
            this.currentWorld = 'Unknown';
            this.currentCoords = { x: 0, y: 0, z: 0 };

            await this.updateEmbed();

            if (this.shouldJoin) {
                await this.attemptReconnect();
            } else {
                this.clearDiscordActivity();
            }
        });

        this.minecraftBot.on('health', () => {
            this.checkHealth();
        });

        this.minecraftBot.on('playerJoined', (player) => {
            setTimeout(() => this.checkPlayerProximity(), 1000);
        });

        this.minecraftBot.on('playerLeft', (player) => {
            this.nearbyPlayers.delete(player.username);
        });

        this.minecraftBot.on('entityMoved', (entity) => {
            if (entity && entity.type === 'player' && entity.username !== this.minecraftBot?.username) {
                this.checkPlayerProximity();
            }
        });

        // Periodic safety checks
        setInterval(() => {
            if (this.isConnected && this.safetyConfig.enabled) {
                this.checkPlayerProximity();
                this.checkHealth();
            }
        }, 5000);
    }

    async extractAuthDetails(message) {
        const urlMatch = message.match(/https:\/\/[^\s]+/);
        const codeMatch = message.match(/code ([A-Z0-9]+)/);

        if (codeMatch && urlMatch && this.authInteraction) {
            const authCode = codeMatch[1];
            const baseUrl = urlMatch[0];
            
            const authUrlWithOtp = baseUrl.includes('?') 
                ? `${baseUrl}&otc=${authCode}` 
                : `${baseUrl}?otc=${authCode}`;
            
            this.authUrl = authUrlWithOtp;
            this.userCode = authCode;

            const updatedEmbed = new EmbedBuilder()
                .setTitle('🔐 Microsoft Authentication Required')
                .setDescription('Please authenticate to connect the Minecraft bot.')
                .addFields(
                    { name: '🔗 Authentication Link', value: `[Click here to authenticate](${authUrlWithOtp})`, inline: false },
                    { name: '🔑 Code (if needed)', value: `\`${authCode}\``, inline: false },
                    { name: '⏳ Status', value: 'Waiting for you to complete authentication...', inline: false }
                )
                .setColor('#ff9900')
                .setTimestamp();

            try {
                await this.authInteraction.editReply({ embeds: [updatedEmbed] });
                await this.updateEmbed();
            } catch (error) {
                console.error('Failed to update auth message:', error);
            }
        }
    }

    async updateEmbed() {
        if (!this.controlMessage) return;

        try {
            const embed = this.createEmbed();
            
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('connect')
                        .setLabel('Connect')
                        .setEmoji('✅')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('disconnect')
                        .setLabel('Disconnect')
                        .setEmoji('❌')
                        .setStyle(ButtonStyle.Danger)
                );

            await this.controlMessage.edit({ 
                embeds: [embed],
                components: [row]
            });
        } catch (error) {
            console.error('Failed to update embed:', error);
        }
    }

    // ========================================================================
    // SLASH COMMANDS
    // ========================================================================

    setupSlashCommands() {
        this.commands = [
            new SlashCommandBuilder()
                .setName('message')
                .setDescription('Send a message to the Minecraft server')
                .addStringOption(option =>
                    option.setName('text')
                        .setDescription('The message to send')
                        .setRequired(true)
                ),
            new SlashCommandBuilder()
                .setName('shards')
                .setDescription('Check available shards on the Minecraft account'),
            new SlashCommandBuilder()
                .setName('status')
                .setDescription('Show bot connection status'),
            new SlashCommandBuilder()
                .setName('connect')
                .setDescription('Connect the bot to the Minecraft server'),
            new SlashCommandBuilder()
                .setName('disconnect')
                .setDescription('Disconnect the bot from the Minecraft server')
        ];
    }

    async registerSlashCommands() {
        try {
            const rest = new REST({ version: '10' }).setToken(CONFIG.discord.token);

            await rest.put(
                Routes.applicationCommands(this.discordClient.user.id),
                { body: this.commands.map(command => command.toJSON()) }
            );
        } catch (error) {
            console.error('Error registering slash commands:', error);
        }
    }

    async handleSlashCommand(interaction) {
        const { commandName } = interaction;

        switch (commandName) {
            case 'message':
                await this.handleMessageCommand(interaction);
                break;
            case 'shards':
                await this.handleShardsCommand(interaction);
                break;
            case 'status':
                await this.handleStatusCommand(interaction);
                break;
            case 'connect':
                await this.handleConnectCommand(interaction);
                break;
            case 'disconnect':
                await this.handleDisconnectCommand(interaction);
                break;
            default:
                await interaction.reply({ content: '❌ Unknown command!', flags: [MessageFlags.Ephemeral] });
        }
    }

    async handleMessageCommand(interaction) {
        const message = interaction.options.getString('text');

        if (!this.isConnected || !this.minecraftBot) {
            await interaction.reply({ 
                content: '❌ Bot is not connected to the Minecraft server!', 
                flags: [MessageFlags.Ephemeral] 
            });
            return;
        }

        try {
            this.minecraftBot.chat(message);
            await interaction.reply({ 
                content: `✅ Message sent: "${message}"`, 
                flags: [MessageFlags.Ephemeral] 
            });
        } catch (error) {
            await interaction.reply({ 
                content: '❌ Failed to send message to Minecraft server!', 
                flags: [MessageFlags.Ephemeral] 
            });
        }
    }

    async handleShardsCommand(interaction) {
        if (!this.isConnected || !this.minecraftBot) {
            await interaction.reply({ 
                content: '❌ Bot is not connected to the Minecraft server!', 
                flags: [MessageFlags.Ephemeral] 
            });
            return;
        }

        await interaction.deferReply();

        try {
            const messageListener = (message) => {
                const messageText = message.toString();
                
                if (messageText.includes('shard') || messageText.includes('Shard')) {
                    this.handleShardsResponse(interaction, messageText);
                    this.minecraftBot.removeListener('message', messageListener);
                }
            };

            this.minecraftBot.on('message', messageListener);
            this.minecraftBot.chat('/shards');

            setTimeout(() => {
                this.minecraftBot?.removeListener('message', messageListener);
                if (!interaction.replied) {
                    interaction.editReply({
                        content: '⏰ No response from server. The /shards command may not be available or took too long to respond.'
                    });
                }
            }, 10000);

        } catch (error) {
            await interaction.editReply({ 
                content: '❌ Failed to request shards information!' 
            });
        }
    }

    async handleStatusCommand(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('🤖 Bot Status')
            .setColor(this.isConnected ? '#00ff00' : '#ff0000')
            .addFields(
                { name: '🎮 Minecraft', value: this.isConnected ? '✅ Connected' : '❌ Disconnected', inline: true },
                { name: '💬 Discord', value: '✅ Connected', inline: true },
                { name: '🌐 Web Server', value: `✅ Running on port ${CONFIG.webServer.port}`, inline: true }
            );

        if (this.isConnected && this.minecraftBot) {
            embed.addFields(
                { name: '👤 Username', value: this.minecraftBot.username || 'Unknown', inline: true },
                { name: '🌍 World', value: this.currentWorld, inline: true },
                { name: '📍 Position', value: `X: ${Math.round(this.currentCoords.x)}, Y: ${Math.round(this.currentCoords.y)}, Z: ${Math.round(this.currentCoords.z)}`, inline: true }
            );
        }

        embed.setTimestamp();
        await interaction.reply({ embeds: [embed] });
    }

    async handleConnectCommand(interaction) {
        if (this.isConnected) {
            await interaction.reply({ 
                content: '✅ Bot is already connected to the Minecraft server!', 
                flags: [MessageFlags.Ephemeral] 
            });
            return;
        }

        this.shouldJoin = true;
        this.reconnectAttempts = 0;
        this.lastAuthUser = interaction.user;
        await this.connectToMinecraft();
        
        await interaction.reply({ 
            content: '🔄 Attempting to connect to the Minecraft server...', 
            flags: [MessageFlags.Ephemeral] 
        });
    }

    async handleDisconnectCommand(interaction) {
        if (!this.isConnected) {
            await interaction.reply({ 
                content: '❌ Bot is not connected to the Minecraft server!', 
                flags: [MessageFlags.Ephemeral] 
            });
            return;
        }

        this.shouldJoin = false;
        this.reconnectAttempts = 0;
        
        if (this.minecraftBot) {
            this.minecraftBot.quit();
            this.minecraftBot = null;
        }
        
        this.isConnected = false;
        this.clearDiscordActivity();
        await this.updateEmbed();
        await interaction.reply({ 
            content: '✅ Bot disconnected from the Minecraft server!', 
            flags: [MessageFlags.Ephemeral] 
        });
    }

    async handleShardsResponse(interaction, messageText) {
        try {
            let shardsInfo = 'Unknown';
            
            const patterns = [
                /shards?[:\s]+([0-9,]+)/i,
                /([0-9,]+)\s+shards?/i,
                /balance[:\s]+([0-9,]+)/i,
                /you\s+have[:\s]+([0-9,]+)/i
            ];
            
            for (const pattern of patterns) {
                const match = messageText.match(pattern);
                if (match) {
                    shardsInfo = match[1];
                    break;
                }
            }
            
            const embed = new EmbedBuilder()
                .setTitle('💎 Shard Balance')
                .setColor('#9d4edd')
                .setTimestamp();
            
            if (shardsInfo !== 'Unknown') {
                embed.addFields({
                    name: '💰 Available Shards',
                    value: shardsInfo,
                    inline: true
                });
                embed.setDescription('Current shard balance on your account');
            } else {
                embed.setDescription('Shard information received but could not parse the amount.');
                embed.addFields({
                    name: '📋 Raw Response',
                    value: messageText.substring(0, 1000),
                    inline: false
                });
            }
            
            if (!interaction.replied) {
                const reply = await interaction.editReply({ embeds: [embed] });
                
                setTimeout(async () => {
                    try {
                        await reply.delete();
                    } catch (error) {
                        // Silent error
                    }
                }, 10000);
            }
            
        } catch (error) {
            if (!interaction.replied) {
                await interaction.editReply({
                    content: '❌ Error processing shards response!'
                });
            }
        }
    }

    // ========================================================================
    // SHUTDOWN
    // ========================================================================

    async shutdown() {
        if (this.statusUpdateInterval) {
            clearInterval(this.statusUpdateInterval);
        }
        if (this.authCheckInterval) {
            clearInterval(this.authCheckInterval);
        }

        if (this.minecraftBot) {
            this.minecraftBot.quit();
        }

        if (this.discordClient) {
            this.discordClient.destroy();
        }

        if (this.server) {
            return new Promise((resolve) => {
                this.server.close(() => {
                    resolve();
                });
            });
        }
    }
}

// ============================================================================
// STARTUP SEQUENCE
// ============================================================================

StartupLogger.showBanner();

const bot = new MinecraftDiscordBot();
bot.start().catch((error) => {
    StartupLogger.error(`Startup failed: ${error.message}`);
    process.exit(1);
});

// ============================================================================
// ERROR HANDLING & PROCESS MANAGEMENT
// ============================================================================

const gracefulShutdown = async (signal) => {
    StartupLogger.warning(`Received ${signal}, shutting down gracefully...`);
    try {
        await bot.shutdown();
        StartupLogger.success('Shutdown complete');
        process.exit(0);
    } catch (error) {
        StartupLogger.error(`Error during shutdown: ${error.message}`);
        process.exit(1);
    }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
    StartupLogger.error(`Uncaught exception: ${error.message}`);
    console.error(error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    StartupLogger.error(`Unhandled rejection: ${reason}`);
    console.error('Promise:', promise);
});
