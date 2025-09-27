const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require('discord.js');
const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');

// Configuration
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
        port: process.env.PORT || 5000,
        host: '0.0.0.0'
    }
};

class MinecraftDiscordBot {
    constructor() {
        this.discordClient = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.GuildMessageReactions
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
        this.authMessage = null;
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
            enabled: false, // toggle safety monitoring
            proximityRadius: 50, // blocks
            minHealth: 10, // health points (out of 20)
            alertCooldown: 30000 // 30 seconds between alerts
        };
        this.nearbyPlayers = new Map();
        this.lastHealthAlert = 0;
        this.lastProximityAlert = 0;
        this.currentHealth = 20;
        this.lastHealth = 20;

        this.setupDiscordEvents();
        this.setupSlashCommands();
    }

    async start() {
        try {
            // Start Discord bot first
            await this.discordClient.login(CONFIG.discord.token);
            console.log('✅ Discord bot connected successfully!');

            // Set initial Discord activity
            this.updateDiscordActivity('🔴 Offline', require('discord.js').ActivityType.Watching);

            // Start periodic status updates every 30 seconds
            this.statusUpdateInterval = setInterval(() => {
                if (this.isConnected && this.minecraftBot) {
                    this.updatePositionInfo();
                    this.updateEmbed();
                    this.updateDiscordActivity();
                }
            }, 30000);

            // Start web server after Discord bot is ready
            await this.startWebServer();

        } catch (error) {
            console.error('Failed to start services:', error);
        }
    }

    async startWebServer() {
        this.app = express();
        
        // Middleware
        this.app.use(express.json());
        this.app.use(express.static('public')); // Serve static files if you have any

        // Routes
        this.setupWebRoutes();

        // Create HTTP server
        this.server = http.createServer(this.app);

        // Start listening
        return new Promise((resolve, reject) => {
            this.server.listen(CONFIG.webServer.port, CONFIG.webServer.host, (error) => {
                if (error) {
                    console.error('Failed to start web server:', error);
                    reject(error);
                } else {
                    console.log(`Web server running on http://${CONFIG.webServer.host}:${CONFIG.webServer.port}`);
                    resolve();
                }
            });
        });
    }

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
            res.json({
                minecraft: {
                    connected: this.isConnected,
                    shouldJoin: this.shouldJoin,
                    username: this.minecraftBot?.username || null,
                    server: `${CONFIG.minecraft.host}:${CONFIG.minecraft.port}`,
                    version: CONFIG.minecraft.version,
                    world: this.currentWorld,
                    coordinates: this.currentCoords,
                    reconnectAttempts: this.reconnectAttempts,
                    maxReconnectAttempts: this.maxReconnectAttempts,
                    authRequired: !!(this.authUrl && this.userCode)
                },
                discord: {
                    connected: this.discordClient.readyTimestamp !== null,
                    username: this.discordClient.user?.tag || null,
                    guildCount: this.discordClient.guilds.cache.size
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

        // Root endpoint with basic info
        this.app.get('/', (req, res) => {
            res.json({
                name: 'Minecraft Discord Bot API',
                version: '1.0.0',
                endpoints: {
                    'GET /': 'This endpoint',
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
                availableEndpoints: ['/', '/health', '/status', '/connect', '/disconnect', '/chat']
            });
        });
    }

    setupDiscordEvents() {
        this.discordClient.once('ready', async () => {
            console.log(`Logged in as ${this.discordClient.user.tag}`);
            await this.registerSlashCommands();
            await this.setupControlMessage();
        });

        this.discordClient.on('messageReactionAdd', async (reaction, user) => {
            if (user.bot) return;
            if (reaction.message.id !== this.controlMessage?.id) return;

            if (reaction.emoji.name === '✅') {
                this.shouldJoin = true;
                this.lastAuthUser = user;
                this.reconnectAttempts = 0;

                const authEmbed = new EmbedBuilder()
                    .setTitle('🔐 Microsoft Authentication Required')
                    .setDescription(`${user}, please authenticate to connect the Minecraft bot.`)
                    .addFields(
                        { name: '🔗 Authentication Link', value: '[Click here to authenticate](https://www.microsoft.com/link)', inline: false },
                        { name: '⏳ Status', value: 'Waiting for authentication code...', inline: false }
                    )
                    .setColor('#ff9900')
                    .setTimestamp();

                this.authMessage = await reaction.message.channel.send({ embeds: [authEmbed] });
                console.log('🔐 Authentication message sent to Discord channel');

                this.updateDiscordActivity('⏳ Starting connection...', require('discord.js').ActivityType.Watching);

                setTimeout(() => {
                    if (this.authMessage && !this.isConnected) {
                        console.log('🔍 Checking for authentication completion...');
                        this.forceCheckAuthCode();
                    }
                }, 3000);

                await this.connectToMinecraft();

            } else if (reaction.emoji.name === '❌') {
                this.shouldJoin = false;
                this.reconnectAttempts = 0;
                if (this.minecraftBot) {
                    this.minecraftBot.quit();
                    this.minecraftBot = null;
                }
                this.updateDiscordActivity('🔴 Standby', require('discord.js').ActivityType.Watching);
                await this.updateEmbed();
            }

            await reaction.users.remove(user.id);
        });

        // Handle slash commands
        this.discordClient.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand()) return;

            // Check if command is used in the correct channel
            if (interaction.channelId !== CONFIG.discord.channelId) {
                await interaction.reply({ 
                    content: '❌ This bot can only be used in the designated channel!', 
                    ephemeral: true 
                });
                return;
            }

            try {
                await this.handleSlashCommand(interaction);
            } catch (error) {
                console.error('Error handling slash command:', error);
                const errorMessage = 'There was an error while executing this command!';
                
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: errorMessage, ephemeral: true });
                } else {
                    await interaction.reply({ content: errorMessage, ephemeral: true });
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
        this.controlMessage = await channel.send({ embeds: [embed] });

        await this.controlMessage.react('✅');
        await this.controlMessage.react('❌');
    }

    createEmbed() {
        const statusColor = this.isConnected ? '#00ff00' : this.shouldJoin ? '#ff9900' : '#ff0000';
        const embed = new EmbedBuilder()
            .setTitle('🎮 Minecraft AFK Bot')
            .setColor(statusColor)
            .addFields(
                { name: '🖥️ Server', value: `\`${CONFIG.minecraft.host}\``, inline: true },
                { name: '🔗 Status', value: this.getStatusText(), inline: true },
                { name: '🛡️ Safety', value: this.safetyConfig.enabled ? (this.isConnected ? '✅ Active' : '❌ Inactive') : '⏸️ Disabled', inline: true }
            );

        if (this.isConnected && this.minecraftBot) {
            embed.addFields(
                { name: '👤 Player', value: `\`${this.minecraftBot.username}\``, inline: true },
                { name: '🌍 World', value: `\`${this.currentWorld}\``, inline: true },
                { name: '❤️ Health', value: `\`${this.currentHealth}/20\``, inline: true },
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
            .setFooter({ text: '✅ Connect | ❌ Disconnect' });

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

    updateDiscordActivity(customStatus = null, activityType = 0) {
        if (!this.discordClient || !this.discordClient.user) return;

        try {
            const { ActivityType } = require('discord.js');
            let status = customStatus;
            
            if (!customStatus) {
                if (this.isConnected && this.minecraftBot) {
                    const safetyStatus = this.safetyConfig.enabled ? '🛡️' : '';
                    status = `${safetyStatus} AFK on ${CONFIG.minecraft.host}`;
                    activityType = ActivityType.Playing;
                } else if (this.shouldJoin) {
                    if (this.authUrl && this.userCode) {
                        status = '🔐 Waiting for auth...';
                        activityType = ActivityType.Watching;
                    } else {
                        status = '⏳ Connecting to server...';
                        activityType = ActivityType.Watching;
                    }
                } else {
                    status = '🔴 Standby';
                    activityType = ActivityType.Watching;
                }
            }

            this.discordClient.user.setActivity(status, { type: activityType });
            console.log(`Discord activity updated: ${status}`);
        } catch (error) {
            console.error('Failed to update Discord activity:', error);
        }
    }

    // Safety Methods
    async sendSafetyAlert(title, description, color = '#ff0000', isUrgent = false) {
        try {
            // Send DM to the user who logged in (reacted with ✅)
            if (!this.lastAuthUser) {
                console.log('No authenticated user to send safety alert to');
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(description)
                .setColor(color)
                .addFields(
                    { name: '📍 **Location**', value: `\`X: ${Math.round(this.currentCoords.x)}, Y: ${Math.round(this.currentCoords.y)}, Z: ${Math.round(this.currentCoords.z)}\``, inline: true },
                    { name: '🌍 **World**', value: `\`${this.currentWorld}\``, inline: true },
                    { name: '❤️ **Health**', value: `\`${this.currentHealth}/20\``, inline: true },
                    { name: '⏰ **Time**', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: false }
                )
                .setTimestamp()
                .setFooter({ text: 'AFK Bot Safety System' });

            const messageContent = isUrgent ? '🚨 **URGENT SAFETY ALERT** 🚨' : '⚠️ **Safety Alert**';
            
            await this.lastAuthUser.send({ 
                content: messageContent, 
                embeds: [embed] 
            });
            
            console.log(`Safety alert sent to ${this.lastAuthUser.tag}: ${title}`);
        } catch (error) {
            console.error('Failed to send safety alert DM:', error);
            // Fallback to channel if DM fails
            try {
                const channel = await this.discordClient.channels.fetch(CONFIG.discord.channelId);
                if (channel) {
                    await channel.send({ 
                        content: `⚠️ Failed to DM ${this.lastAuthUser?.tag || 'user'} - Safety Alert: **${title}**\n${description}` 
                    });
                }
            } catch (fallbackError) {
                console.error('Failed to send fallback safety alert:', fallbackError);
            }
        }
    }

    checkPlayerProximity() {
        if (!this.safetyConfig.enabled || !this.minecraftBot || !this.minecraftBot.players) return;

        const now = Date.now();
        if (now - this.lastProximityAlert < this.safetyConfig.alertCooldown) return;

        const myPos = this.minecraftBot.entity.position;
        const nearbyPlayers = [];

        for (const [username, player] of Object.entries(this.minecraftBot.players)) {
            if (username === this.minecraftBot.username) continue;
            if (!player.entity || !player.entity.position) continue;

            const distance = myPos.distanceTo(player.entity.position);
            if (distance <= this.safetyConfig.proximityRadius) {
                nearbyPlayers.push({ username, distance: Math.round(distance) });
            }
        }

        if (nearbyPlayers.length > 0) {
            this.lastProximityAlert = now;
            const playerList = nearbyPlayers.map(p => `**${p.username}** (${p.distance}m)`).join(', ');
            this.sendSafetyAlert(
                '⚠️ Player Proximity Alert',
                `**${nearbyPlayers.length} player(s) detected within ${this.safetyConfig.proximityRadius} blocks:**\n${playerList}`,
                '#ff9900',
                true
            );
        }
    }

    async checkHealth() {
        if (!this.safetyConfig.enabled || !this.minecraftBot || !this.minecraftBot.health) return;

        this.lastHealth = this.currentHealth;
        this.currentHealth = this.minecraftBot.health;

        // Check for health decrease (taking damage)
        if (this.currentHealth < this.lastHealth) {
            const damage = this.lastHealth - this.currentHealth;
            this.sendSafetyAlert(
                '🩸 Damage Taken',
                `**You took ${damage} damage!**\nHealth decreased from ${this.lastHealth} to ${this.currentHealth}`,
                '#ff0000',
                true
            );
        }

        // Check for low health
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

    async attemptReconnect() {
        if (!this.shouldJoin) {
            console.log('[RECONNECT] Reconnection cancelled - shouldJoin is false');
            return;
        }

        if (this.isConnecting) {
            console.log('[RECONNECT] Connection already in progress, skipping');
            return;
        }

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('[RECONNECT] Max reconnection attempts reached');
            this.shouldJoin = false;
            await this.updateEmbed();
            return;
        }

        this.reconnectAttempts++;
        console.log(`[RECONNECT] Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);

        await this.updateEmbed();

        // Add longer delay between reconnect attempts to avoid "already online" issues
        const delay = this.reconnectDelay * this.reconnectAttempts; // Exponential backoff
        console.log(`[RECONNECT] Waiting ${delay}ms before next attempt`);

        setTimeout(async () => {
            if (this.shouldJoin && !this.isConnected && !this.isConnecting) {
                await this.connectToMinecraft();
            }
        }, delay);
    }

    async connectToMinecraft() {
        if (this.isConnecting) {
            console.log('🎮 Connection already in progress, skipping...');
            return;
        }

        if (this.minecraftBot) {
            this.minecraftBot.quit();
        }

        try {
            this.isConnecting = true;
            console.log('🎮 Connecting to Minecraft server...');
            await this.updateEmbed();

            this.setupConsoleCapture();

            if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
                console.log('Production environment detected - attempting to handle auth differently');
                if (process.env.MC_ACCESS_TOKEN && process.env.MC_REFRESH_TOKEN) {
                    console.log('Using stored authentication tokens for production');
                } else {
                    console.log('No stored authentication tokens found. Bot will need manual authentication.');
                    console.log('Available env vars:', Object.keys(process.env).filter(key => key.startsWith('MC_') || key.includes('TOKEN')));
                }
            }

            this.minecraftBot = mineflayer.createBot({
                host: CONFIG.minecraft.host,
                port: CONFIG.minecraft.port,
                version: CONFIG.minecraft.version,
                auth: CONFIG.minecraft.auth
            });

            this.setupMinecraftEvents();

            this.authCheckTimeout = setTimeout(() => {
                if (!this.authMessageSent && !this.isConnected) {
                    console.log('[DEBUG] No authentication message detected after 5 seconds - checking connection status');
                    if (this.isConnected) {
                        console.log('[DEBUG] Bot connected without authentication prompt - using cached login');
                    } else {
                        console.log('[DEBUG] Bot still not connected - may need manual authentication');
                    }
                }
            }, 5000);

        } catch (error) {
            console.error('Failed to connect to Minecraft:', error);
            this.isConnecting = false;
            if (this.shouldJoin) {
                console.log('[RECONNECT] Connection failed, attempting reconnect...');
                await this.attemptReconnect();
            } else {
                await this.updateEmbed();
            }
        }
    }

    setupConsoleCapture() {
        // Simplified console capture for auth detection only
        if (!this.originalStderrWrite) {
            this.originalStderrWrite = process.stderr.write;
            process.stderr.write = (chunk, encoding, callback) => {
                const message = chunk.toString();

                // Only capture auth messages, suppress debug spam
                if (message.includes('microsoft.com/link') && message.includes('use the code')) {
                    this.extractAuthDetails(message);
                } else if (message.includes('Chunk size') || message.includes('partial packet')) {
                    // Suppress these debug messages completely
                    return true;
                }

                return this.originalStderrWrite.call(process.stderr, chunk, encoding, callback);
            };
        }

        if (!this.originalStdoutWrite) {
            this.originalStdoutWrite = process.stdout.write;
            process.stdout.write = (chunk, encoding, callback) => {
                const message = chunk.toString();

                // Only capture auth messages, suppress debug spam
                if (message.includes('microsoft.com/link') && message.includes('use the code')) {
                    this.extractAuthDetails(message);
                } else if (message.includes('Chunk size') || message.includes('partial packet')) {
                    // Suppress these debug messages completely
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
            console.log('✅ Successfully connected to Minecraft server!');
            this.isConnected = true;
            this.isConnecting = false;
            this.authUrl = null;
            this.userCode = null;
            this.authMessageSent = false;
            this.reconnectAttempts = 0;

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
                    console.log('🗑️  Authentication message cleaned up');
                    this.authMessage = null;
                } catch (error) {
                    console.error('⚠️  Failed to clean up auth message:', error);
                }
            }

            this.updateDiscordActivity();
            await this.updateEmbed();
        });

        this.minecraftBot.on('spawn', async () => {
            console.log('🌍 Bot spawned in Minecraft world');

            this.updatePositionInfo();

            if (this.minecraftBot && this.minecraftBot.game && this.minecraftBot.game.dimension) {
                this.currentWorld = this.minecraftBot.game.dimension;
            }

            // Initialize health monitoring
            this.currentHealth = this.minecraftBot.health || 20;
            this.lastHealth = this.currentHealth;

            this.updateDiscordActivity();

            setTimeout(() => {
                if (this.minecraftBot) {
                    this.minecraftBot.chat('/tpa doggomc');
                    console.log('📞 Sent teleport request to doggomc');
                }
            }, 5000);

            await this.updateEmbed();
        });

        this.minecraftBot.on('move', () => {
            this.updatePositionInfo();
            // Check for nearby players when position updates
            this.checkPlayerProximity();
        });

        this.minecraftBot.on('respawn', () => {
            if (this.minecraftBot && this.minecraftBot.game && this.minecraftBot.game.dimension) {
                this.currentWorld = this.minecraftBot.game.dimension;
                console.log('Bot respawned/changed dimension to:', this.currentWorld);
                this.updateEmbed();
            }
        });

        this.minecraftBot.on('end', async (reason) => {
            console.log('🔌 Minecraft connection ended:', reason);
            this.isConnected = false;
            this.isConnecting = false;
            this.minecraftBot = null;
            this.currentWorld = 'Unknown';
            this.currentCoords = { x: 0, y: 0, z: 0 };

            this.updateDiscordActivity();
            await this.updateEmbed();

            if (this.shouldJoin) {
                console.log('[RECONNECT] Connection ended, attempting reconnect...');
                await this.attemptReconnect();
            }
        });

        this.minecraftBot.on('error', async (error) => {
            console.error('❌ Minecraft bot error:', error);
            this.isConnected = false;
            this.isConnecting = false;
            this.currentWorld = 'Unknown';
            this.currentCoords = { x: 0, y: 0, z: 0 };

            await this.updateEmbed();

            if (this.shouldJoin) {
                console.log('[RECONNECT] Error occurred, attempting reconnect...');
                await this.attemptReconnect();
            }
        });

        this.minecraftBot.on('kicked', async (reason) => {
            console.log('⚠️  Bot was kicked from server:', reason);
            this.isConnected = false;
            this.isConnecting = false;
            this.minecraftBot = null;
            this.currentWorld = 'Unknown';
            this.currentCoords = { x: 0, y: 0, z: 0 };

            await this.updateEmbed();

            if (this.shouldJoin) {
                console.log('[RECONNECT] Bot kicked, attempting reconnect...');
                await this.attemptReconnect();
            }
        });

        this.minecraftBot.on('auth_pending', (data) => {
            console.log('Microsoft auth pending:', data);
            this.authUrl = data.verification_uri;
            this.userCode = data.user_code;
            this.updateEmbed();
        });

        // Health monitoring events
        this.minecraftBot.on('health', () => {
            this.checkHealth();
        });

        // Player monitoring events
        this.minecraftBot.on('playerJoined', (player) => {
            console.log(`Player ${player.username} joined - checking proximity`);
            setTimeout(() => this.checkPlayerProximity(), 1000);
        });

        this.minecraftBot.on('playerLeft', (player) => {
            console.log(`Player ${player.username} left`);
            this.nearbyPlayers.delete(player.username);
        });

        // Entity movement monitoring for other players
        this.minecraftBot.on('entityMoved', (entity) => {
            // Check if it's another player entity
            if (entity && entity.type === 'player' && entity.username !== this.minecraftBot.username) {
                this.checkPlayerProximity();
            }
        });

        // Periodic safety checks every 10 seconds
        setInterval(() => {
            if (this.isConnected && this.safetyConfig.enabled) {
                this.checkPlayerProximity();
                this.checkHealth();
            }
        }, 10000);
    }

    async extractAuthDetails(message) {
        const codeMatch = message.match(/code ([A-Z0-9]+)/);

        if (codeMatch && this.lastAuthUser && this.authMessage) {
            const authCode = codeMatch[1];
            console.log('[DEBUG] Found auth code:', authCode, 'updating message');

            const updatedEmbed = new EmbedBuilder()
                .setTitle('🔐 Microsoft Authentication Required')
                .setDescription(`${this.lastAuthUser}, please authenticate to connect the Minecraft bot.`)
                .addFields(
                    { name: '🔗 Authentication Link', value: '[Click here to authenticate](https://www.microsoft.com/link)', inline: false },
                    { name: '🔑 Authentication Code', value: `**${authCode}**`, inline: false },
                    { name: '📝 Instructions', value: '1. Click the link above\n2. Enter the code\n3. Complete authentication', inline: false }
                )
                .setColor('#00ff00')
                .setTimestamp();

            try {
                await this.authMessage.edit({ embeds: [updatedEmbed] });
                console.log('[DEBUG] Successfully updated auth message with code:', authCode);
            } catch (error) {
                console.error('[DEBUG] Failed to update auth message:', error);
                try {
                    const channel = await this.discordClient.channels.fetch(CONFIG.discord.channelId);
                    await channel.send({
                        content: `${this.lastAuthUser} - Authentication code: **${authCode}**\nUse: https://www.microsoft.com/link`
                    });
                } catch (channelError) {
                    console.error('[DEBUG] Failed to send new message too:', channelError);
                }
            }
        } else {
            console.log('[DEBUG] Missing requirements:', { 
                hasCodeMatch: !!codeMatch, 
                hasUser: !!this.lastAuthUser, 
                hasAuthMessage: !!this.authMessage 
            });
        }
    }

    async updateEmbed() {
        if (!this.controlMessage) return;

        try {
            const embed = this.createEmbed();
            await this.controlMessage.edit({ embeds: [embed] });
        } catch (error) {
            console.error('Failed to update embed:', error);
        }
    }

    // Setup slash commands
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

    // Register slash commands with Discord
    async registerSlashCommands() {
        try {
            const rest = new REST({ version: '10' }).setToken(CONFIG.discord.token);

            console.log('🔄 Registering Discord slash commands...');

            await rest.put(
                Routes.applicationCommands(this.discordClient.user.id),
                { body: this.commands.map(command => command.toJSON()) }
            );

            console.log('✅ Discord slash commands registered successfully!');
        } catch (error) {
            console.error('Error registering slash commands:', error);
        }
    }

    // Handle slash command interactions
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
                await interaction.reply({ content: 'Unknown command!', ephemeral: true });
        }
    }

    // Handle /message command
    async handleMessageCommand(interaction) {
        const message = interaction.options.getString('text');

        if (!this.isConnected || !this.minecraftBot) {
            await interaction.reply({ 
                content: '❌ Bot is not connected to the Minecraft server!', 
                ephemeral: true 
            });
            return;
        }

        try {
            this.minecraftBot.chat(message);
            await interaction.reply({ 
                content: `✅ Message sent: "${message}"`, 
                ephemeral: true 
            });
            console.log(`Message sent to Minecraft: ${message}`);
        } catch (error) {
            console.error('Error sending message to Minecraft:', error);
            await interaction.reply({ 
                content: '❌ Failed to send message to Minecraft server!', 
                ephemeral: true 
            });
        }
    }

    // Handle /shards command
    async handleShardsCommand(interaction) {
        if (!this.isConnected || !this.minecraftBot) {
            await interaction.reply({ 
                content: '❌ Bot is not connected to the Minecraft server!', 
                ephemeral: true 
            });
            return;
        }

        await interaction.deferReply();

        try {
            // Set up message listener for shards response
            const messageListener = (message) => {
                const messageText = message.toString();
                
                // Look for shards information in the message
                if (messageText.includes('shard') || messageText.includes('Shard')) {
                    this.handleShardsResponse(interaction, messageText);
                    this.minecraftBot.removeListener('message', messageListener);
                }
            };

            // Add temporary message listener
            this.minecraftBot.on('message', messageListener);

            // Send the /shards command
            this.minecraftBot.chat('/shards');
            console.log('💎 Requested shards information from server');

            // Remove listener after 10 seconds if no response
            setTimeout(() => {
                this.minecraftBot.removeListener('message', messageListener);
                if (!interaction.replied) {
                    interaction.editReply({
                        content: '⏰ No response from server. The /shards command may not be available or took too long to respond.'
                    });
                }
            }, 10000);

        } catch (error) {
            console.error('💎 Error requesting shards:', error);
            await interaction.editReply({ 
                content: '❌ Failed to request shards information!' 
            });
        }
    }

    // Handle /status command
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

    // Handle /connect command
    async handleConnectCommand(interaction) {
        if (this.isConnected) {
            await interaction.reply({ 
                content: '✅ Bot is already connected to the Minecraft server!', 
                ephemeral: true 
            });
            return;
        }

        this.shouldJoin = true;
        this.reconnectAttempts = 0;
        await this.connectToMinecraft();
        
        await interaction.reply({ 
            content: '🔄 Attempting to connect to the Minecraft server...', 
            ephemeral: true 
        });
    }

    // Handle /disconnect command
    async handleDisconnectCommand(interaction) {
        if (!this.isConnected) {
            await interaction.reply({ 
                content: '❌ Bot is not connected to the Minecraft server!', 
                ephemeral: true 
            });
            return;
        }

        this.shouldJoin = false;
        this.reconnectAttempts = 0;
        
        if (this.minecraftBot) {
            this.minecraftBot.quit();
            this.minecraftBot = null;
        }
        
        await this.updateEmbed();
        await interaction.reply({ 
            content: '✅ Bot disconnected from the Minecraft server!', 
            ephemeral: true 
        });
    }

    // Handle shards response from Minecraft
    async handleShardsResponse(interaction, messageText) {
        try {
            console.log('💎 Received shards response:', messageText);
            
            // Parse the message to extract shard information
            let shardsInfo = 'Unknown';
            
            // Look for various patterns that might indicate shard count
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
            
            // Create embed with shard information
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
                    value: messageText.substring(0, 1000), // Limit length
                    inline: false
                });
            }
            
            if (!interaction.replied) {
                const reply = await interaction.editReply({ embeds: [embed] });
                
                // Delete the message after 10 seconds
                setTimeout(async () => {
                    try {
                        await reply.delete();
                        console.log('💎 Shards message auto-deleted after 10 seconds');
                    } catch (error) {
                        console.error('⚠️ Failed to delete shards message:', error.message);
                    }
                }, 10000);
            }
            
        } catch (error) {
            console.error('💎 Error processing shards response:', error);
            if (!interaction.replied) {
                await interaction.editReply({
                    content: '❌ Error processing shards response!'
                });
            }
        }
    }

    // Graceful shutdown method
    async shutdown() {
        console.log('Shutting down services...');

        // Clear intervals
        if (this.statusUpdateInterval) {
            clearInterval(this.statusUpdateInterval);
        }
        if (this.authCheckInterval) {
            clearInterval(this.authCheckInterval);
        }

        // Close Minecraft connection
        if (this.minecraftBot) {
            this.minecraftBot.quit();
        }

        // Close Discord connection
        if (this.discordClient) {
            this.discordClient.destroy();
        }

        // Close web server
        if (this.server) {
            return new Promise((resolve) => {
                this.server.close(() => {
                    console.log('Web server closed');
                    resolve();
                });
            });
        }
    }
}

// Start the bot
const bot = new MinecraftDiscordBot();
bot.start().then(() => {
    console.log('All services started successfully!');
}).catch((error) => {
    console.error('Failed to start services:', error);
    process.exit(1);
});

// Graceful shutdown
const gracefulShutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down gracefully...`);
    try {
        await bot.shutdown();
        console.log('Shutdown complete');
        process.exit(0);
    } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
    }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    gracefulShutdown('unhandledRejection');
});
