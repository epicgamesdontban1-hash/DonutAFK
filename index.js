// ============================================================================
// DOGGO - Minecraft Discord Bot (Improved Architecture)
// ============================================================================

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    SlashCommandBuilder,
    REST,
    Routes,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    ActivityType
} = require('discord.js');
const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const EventEmitter = require('events');

// ============================================================================
// LOGGING SYSTEM
// ============================================================================

class Logger {
    static LEVELS = {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3,
        FATAL: 4
    };

    static currentLevel = Logger.LEVELS.INFO;
    static enableTimestamps = true;
    static enableColors = true;

    static colors = {
        reset: '\x1b[0m',
        red: '\x1b[31m',
        green: '\x1b[32m',
        yellow: '\x1b[33m',
        blue: '\x1b[34m',
        magenta: '\x1b[35m',
        cyan: '\x1b[36m',
        gray: '\x1b[90m'
    };

    static #format(level, message, context = {}) {
        const timestamp = this.enableTimestamps 
            ? `[${new Date().toISOString()}] ` 
            : '';
        const contextStr = Object.keys(context).length 
            ? ` ${JSON.stringify(context)}` 
            : '';
        return `${timestamp}[${level}] ${message}${contextStr}`;
    }

    static #colorize(color, text) {
        if (!this.enableColors) return text;
        return `${this.colors[color]}${text}${this.colors.reset}`;
    }

    static debug(message, context = {}) {
        if (this.currentLevel <= this.LEVELS.DEBUG) {
            console.log(this.#colorize('gray', this.#format('DEBUG', message, context)));
        }
    }

    static info(message, context = {}) {
        if (this.currentLevel <= this.LEVELS.INFO) {
            console.log(this.#colorize('cyan', this.#format('INFO', message, context)));
        }
    }

    static success(message, context = {}) {
        if (this.currentLevel <= this.LEVELS.INFO) {
            console.log(this.#colorize('green', this.#format('SUCCESS', message, context)));
        }
    }

    static warn(message, context = {}) {
        if (this.currentLevel <= this.LEVELS.WARN) {
            console.warn(this.#colorize('yellow', this.#format('WARN', message, context)));
        }
    }

    static error(message, context = {}) {
        if (this.currentLevel <= this.LEVELS.ERROR) {
            console.error(this.#colorize('red', this.#format('ERROR', message, context)));
        }
    }

    static fatal(message, context = {}) {
        console.error(this.#colorize('red', this.#format('FATAL', message, context)));
    }

    static showBanner() {
        const banner = `
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║     ██████╗  ██████╗  ██████╗  ██████╗  ██████╗          ║
║     ██╔══██╗██╔═══██╗██╔════╝ ██╔════╝ ██╔═══██╗         ║
║     ██║  ██║██║   ██║██║  ███╗██║  ███╗██║   ██║         ║
║     ██║  ██║██║   ██║██║   ██║██║   ██║██║   ██║         ║
║     ██████╔╝╚██████╔╝╚██████╔╝╚██████╔╝╚██████╔╝         ║
║     ╚═════╝  ╚═════╝  ╚═════╝  ╚═════╝  ╚═════╝          ║
║                                                           ║
║              Minecraft Discord Bot v2.0                   ║
╚═══════════════════════════════════════════════════════════╝
`;
        console.log(this.#colorize('magenta', banner));
    }
}

// ============================================================================
// CONFIGURATION MANAGEMENT
// ============================================================================

class Config {
    static #instance = null;
    #validated = false;

    constructor() {
        if (Config.#instance) {
            return Config.#instance;
        }

        this.discord = {
            token: process.env.DISCORD_BOT_TOKEN,
            channelId: process.env.DISCORD_CHANNEL_ID
        };

        this.minecraft = {
            host: process.env.MC_HOST || 'donutsmp.net',
            port: parseInt(process.env.MC_PORT) || 25565,
            version: process.env.MC_VERSION || '1.21.4',
            auth: process.env.MC_AUTH || 'microsoft'
        };

        this.webServer = {
            port: parseInt(process.env.PORT) || 5000,
            host: process.env.HOST || '0.0.0.0',
            enabled: process.env.WEB_SERVER_ENABLED !== 'false'
        };

        this.safety = {
            enabled: process.env.SAFETY_ENABLED === 'true',
            proximityRadius: parseInt(process.env.SAFETY_PROXIMITY_RADIUS) || 50,
            minHealth: parseInt(process.env.SAFETY_MIN_HEALTH) || 10,
            alertCooldown: parseInt(process.env.SAFETY_ALERT_COOLDOWN) || 30000,
            autoDisconnectOnThreat: process.env.SAFETY_AUTO_DISCONNECT !== 'false',
            autoDisconnectHealth: parseInt(process.env.SAFETY_DISCONNECT_HEALTH) || 6,
            spawnProtectionRadius: parseInt(process.env.SPAWN_PROTECTION_RADIUS) || 100
        };

        this.reconnect = {
            maxAttempts: parseInt(process.env.RECONNECT_MAX_ATTEMPTS) || 10000,
            baseDelay: parseInt(process.env.RECONNECT_BASE_DELAY) || 15000,
            maxDelay: parseInt(process.env.RECONNECT_MAX_DELAY) || 300000,
            backoffMultiplier: parseFloat(process.env.RECONNECT_BACKOFF) || 1.5
        };

        this.trustedPlayers = new Set(
            (process.env.TRUSTED_PLAYERS || '').split(',').filter(Boolean)
        );
        
        this.blockedPlayers = new Set(
            (process.env.BLOCKED_PLAYERS || '').split(',').filter(Boolean)
        );

        Config.#instance = this;
    }

    validate() {
        const errors = [];

        if (!this.discord.token) {
            errors.push('DISCORD_BOT_TOKEN is required');
        }

        if (!this.discord.channelId) {
            errors.push('DISCORD_CHANNEL_ID is required');
        }

        if (!this.minecraft.host) {
            errors.push('Minecraft host is required');
        }

        if (this.minecraft.port < 1 || this.minecraft.port > 65535) {
            errors.push('Minecraft port must be between 1 and 65535');
        }

        if (errors.length > 0) {
            throw new ConfigurationError(
                `Configuration validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`
            );
        }

        this.#validated = true;
        return true;
    }

    isValidated() {
        return this.#validated;
    }

    static getInstance() {
        if (!Config.#instance) {
            new Config();
        }
        return Config.#instance;
    }
}

// ============================================================================
// CUSTOM ERRORS
// ============================================================================

class ConfigurationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConfigurationError';
    }
}

class ConnectionError extends Error {
    constructor(message, cause = null) {
        super(message);
        this.name = 'ConnectionError';
        this.cause = cause;
    }
}

class AuthenticationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AuthenticationError';
    }
}

// ============================================================================
// RATE LIMITER
// ============================================================================

class RateLimiter {
    #tokens;
    #maxTokens;
    #refillRate;
    #lastRefill;

    constructor(maxTokens = 10, refillRatePerSecond = 1) {
        this.#maxTokens = maxTokens;
        this.#tokens = maxTokens;
        this.#refillRate = refillRatePerSecond;
        this.#lastRefill = Date.now();
    }

    #refill() {
        const now = Date.now();
        const elapsed = (now - this.#lastRefill) / 1000;
        this.#tokens = Math.min(this.#maxTokens, this.#tokens + elapsed * this.#refillRate);
        this.#lastRefill = now;
    }

    tryConsume(tokens = 1) {
        this.#refill();
        if (this.#tokens >= tokens) {
            this.#tokens -= tokens;
            return true;
        }
        return false;
    }

    getWaitTime(tokens = 1) {
        this.#refill();
        if (this.#tokens >= tokens) return 0;
        return ((tokens - this.#tokens) / this.#refillRate) * 1000;
    }
}

// ============================================================================
// CONNECTION STATE MACHINE
// ============================================================================

class ConnectionState {
    static DISCONNECTED = 'disconnected';
    static CONNECTING = 'connecting';
    static AUTHENTICATING = 'authenticating';
    static CONNECTED = 'connected';
    static RECONNECTING = 'reconnecting';
    static ERROR = 'error';

    static #validTransitions = {
        [this.DISCONNECTED]: [this.CONNECTING],
        [this.CONNECTING]: [this.AUTHENTICATING, this.CONNECTED, this.ERROR, this.DISCONNECTED],
        [this.AUTHENTICATING]: [this.CONNECTED, this.ERROR, this.DISCONNECTED],
        [this.CONNECTED]: [this.DISCONNECTED, this.ERROR],
        [this.RECONNECTING]: [this.CONNECTING, this.DISCONNECTED],
        [this.ERROR]: [this.RECONNECTING, this.DISCONNECTED]
    };

    #currentState = ConnectionState.DISCONNECTED;
    #listeners = new Map();
    #stateHistory = [];

    get current() {
        return this.#currentState;
    }

    get history() {
        return [...this.#stateHistory];
    }

    canTransitionTo(newState) {
        const validTargets = ConnectionState.#validTransitions[this.#currentState];
        return validTargets && validTargets.includes(newState);
    }

    transition(newState, metadata = {}) {
        if (!this.canTransitionTo(newState)) {
            Logger.warn(`Invalid state transition: ${this.#currentState} -> ${newState}`);
            return false;
        }

        const oldState = this.#currentState;
        this.#currentState = newState;
        
        this.#stateHistory.push({
            from: oldState,
            to: newState,
            timestamp: Date.now(),
            metadata
        });

        if (this.#stateHistory.length > 100) {
            this.#stateHistory.shift();
        }

        this.#notifyListeners(oldState, newState, metadata);
        return true;
    }

    forceState(newState, metadata = {}) {
        const oldState = this.#currentState;
        this.#currentState = newState;
        this.#notifyListeners(oldState, newState, { ...metadata, forced: true });
    }

    onTransition(callback) {
        const id = Symbol();
        this.#listeners.set(id, callback);
        return () => this.#listeners.delete(id);
    }

    #notifyListeners(oldState, newState, metadata) {
        for (const callback of this.#listeners.values()) {
            try {
                callback(oldState, newState, metadata);
            } catch (error) {
                Logger.error('State transition listener error', { error: error.message });
            }
        }
    }

    isConnected() {
        return this.#currentState === ConnectionState.CONNECTED;
    }

    isDisconnected() {
        return this.#currentState === ConnectionState.DISCONNECTED;
    }
}

// ============================================================================
// SAFETY MONITOR
// ============================================================================

class SafetyMonitor extends EventEmitter {
    #config;
    #minecraftBot;
    #lastHealthAlert = 0;
    #lastProximityAlert = 0;
    #nearbyPlayers = new Map();
    #currentHealth = 20;
    #lastHealth = 20;
    #checkInterval = null;

    constructor(config) {
        super();
        this.#config = config.safety;
    }

    attach(minecraftBot) {
        this.#minecraftBot = minecraftBot;
        this.#setupEventListeners();
        this.#startPeriodicChecks();
    }

    detach() {
        if (this.#checkInterval) {
            clearInterval(this.#checkInterval);
            this.#checkInterval = null;
        }
        this.#minecraftBot = null;
        this.#nearbyPlayers.clear();
    }

    #setupEventListeners() {
        if (!this.#minecraftBot) return;

        this.#minecraftBot.on('health', () => this.#checkHealth());
        this.#minecraftBot.on('move', () => this.#checkPlayerProximity());
        this.#minecraftBot.on('playerJoined', () => {
            setTimeout(() => this.#checkPlayerProximity(), 1000);
        });
        this.#minecraftBot.on('playerLeft', (player) => {
            this.#nearbyPlayers.delete(player.username);
        });
    }

    #startPeriodicChecks() {
        this.#checkInterval = setInterval(() => {
            if (this.#config.enabled) {
                this.#checkPlayerProximity();
                this.#checkHealth();
            }
        }, 10000);
    }

    #checkHealth() {
        if (!this.#config.enabled || !this.#minecraftBot?.health) return;

        this.#lastHealth = this.#currentHealth;
        this.#currentHealth = this.#minecraftBot.health;

        const damage = this.#lastHealth - this.#currentHealth;
        
        if (damage > 0) {
            if (this.#currentHealth <= this.#config.autoDisconnectHealth) {
                this.emit('critical-health', {
                    health: this.#currentHealth,
                    damage,
                    action: 'disconnect'
                });
            } else {
                this.emit('damage-taken', {
                    health: this.#currentHealth,
                    damage,
                    previousHealth: this.#lastHealth
                });
            }
        }

        const now = Date.now();
        if (this.#currentHealth <= this.#config.minHealth && 
            now - this.#lastHealthAlert > this.#config.alertCooldown) {
            this.#lastHealthAlert = now;
            this.emit('low-health', { health: this.#currentHealth });
        }
    }

    #checkPlayerProximity() {
        if (!this.#config.enabled || !this.#minecraftBot?.players) return;

        const now = Date.now();
        if (now - this.#lastProximityAlert < this.#config.alertCooldown) return;

        const myPos = this.#minecraftBot.entity?.position;
        if (!myPos) return;

        const nearbyPlayers = [];
        const threats = [];
        const trustedPlayers = Config.getInstance().trustedPlayers;
        const blockedPlayers = Config.getInstance().blockedPlayers;

        const isInSpawnArea = Math.abs(myPos.x) <= this.#config.spawnProtectionRadius && 
                              Math.abs(myPos.z) <= this.#config.spawnProtectionRadius;

        for (const [username, player] of Object.entries(this.#minecraftBot.players)) {
            if (username === this.#minecraftBot.username) continue;
            if (!player.entity?.position) continue;

            const distance = myPos.distanceTo(player.entity.position);
            
            if (distance <= this.#config.proximityRadius) {
                const playerInfo = {
                    username,
                    distance: Math.round(distance),
                    isTrusted: trustedPlayers.has(username),
                    isBlocked: blockedPlayers.has(username)
                };
                
                nearbyPlayers.push(playerInfo);

                if (!playerInfo.isTrusted && distance <= 20) {
                    threats.push(playerInfo);
                }
            }
        }

        if (nearbyPlayers.length > 0) {
            this.#lastProximityAlert = now;

            if (isInSpawnArea && threats.length > 0) {
                this.emit('spawn-area-players', {
                    players: nearbyPlayers,
                    position: myPos
                });
                return;
            }

            if (this.#config.autoDisconnectOnThreat && threats.length > 0) {
                this.emit('threat-detected', {
                    threats,
                    action: 'disconnect'
                });
                return;
            }

            this.emit('players-nearby', { players: nearbyPlayers });
        }
    }

    get currentHealth() {
        return this.#currentHealth;
    }

    get nearbyPlayers() {
        return new Map(this.#nearbyPlayers);
    }
}

// ============================================================================
// MINECRAFT BOT MANAGER
// ============================================================================

class MinecraftBotManager extends EventEmitter {
    #config;
    #bot = null;
    #connectionState;
    #safetyMonitor;
    #reconnectAttempts = 0;
    #reconnectTimeout = null;
    #authData = null;
    #currentWorld = 'Unknown';
    #currentCoords = { x: 0, y: 0, z: 0 };
    #shouldReconnect = false;

    constructor(config, safetyMonitor) {
        super();
        this.#config = config;
        this.#connectionState = new ConnectionState();
        this.#safetyMonitor = safetyMonitor;

        this.#setupStateListeners();
        this.#setupSafetyListeners();
    }

    #setupStateListeners() {
        this.#connectionState.onTransition((oldState, newState, metadata) => {
            Logger.info(`Connection state: ${oldState} -> ${newState}`, metadata);
            this.emit('stateChange', { oldState, newState, metadata });
        });
    }

    #setupSafetyListeners() {
        this.#safetyMonitor.on('critical-health', (data) => {
            this.emit('safetyAlert', { type: 'critical-health', ...data });
            if (data.action === 'disconnect') {
                this.disconnect('Critical health - safety disconnect');
            }
        });

        this.#safetyMonitor.on('threat-detected', (data) => {
            this.emit('safetyAlert', { type: 'threat-detected', ...data });
            if (data.action === 'disconnect') {
                setTimeout(() => {
                    this.disconnect('Threat detected - safety disconnect');
                }, 1000);
            }
        });

        this.#safetyMonitor.on('damage-taken', (data) => {
            this.emit('safetyAlert', { type: 'damage-taken', ...data });
        });

        this.#safetyMonitor.on('low-health', (data) => {
            this.emit('safetyAlert', { type: 'low-health', ...data });
        });

        this.#safetyMonitor.on('players-nearby', (data) => {
            this.emit('safetyAlert', { type: 'players-nearby', ...data });
        });

        this.#safetyMonitor.on('spawn-area-players', (data) => {
            this.emit('safetyAlert', { type: 'spawn-area-players', ...data });
        });
    }

    async connect() {
        if (!this.#connectionState.canTransitionTo(ConnectionState.CONNECTING)) {
            Logger.warn('Cannot connect from current state', { 
                state: this.#connectionState.current 
            });
            return false;
        }

        this.#shouldReconnect = true;
        this.#connectionState.transition(ConnectionState.CONNECTING);

        try {
            await this.#createBot();
            return true;
        } catch (error) {
            Logger.error('Failed to create bot', { error: error.message });
            this.#connectionState.forceState(ConnectionState.ERROR, { error: error.message });
            this.#scheduleReconnect();
            return false;
        }
    }

    async #createBot() {
        if (this.#bot) {
            this.#bot.quit();
            this.#bot = null;
        }

        this.#setupAuthCapture();

        this.#bot = mineflayer.createBot({
            host: this.#config.minecraft.host,
            port: this.#config.minecraft.port,
            version: this.#config.minecraft.version,
            auth: this.#config.minecraft.auth
        });

        this.#setupBotEvents();
    }

    #setupBotEvents() {
        this.#bot.on('login', async () => {
            this.#connectionState.transition(ConnectionState.CONNECTED);
            this.#reconnectAttempts = 0;
            this.#authData = null;

            if (this.#bot.game?.dimension) {
                this.#currentWorld = this.#bot.game.dimension;
            }

            this.#safetyMonitor.attach(this.#bot);
            this.emit('connected', { username: this.#bot.username });
        });

        this.#bot.on('spawn', async () => {
            this.#updatePosition();
            
            if (this.#bot.game?.dimension) {
                this.#currentWorld = this.#bot.game.dimension;
            }

            this.emit('spawned', {
                world: this.#currentWorld,
                position: this.#currentCoords
            });

            const tpaTarget = process.env.AUTO_TPA_TARGET;
            if (tpaTarget) {
                setTimeout(() => {
                    if (this.#bot) {
                        this.#bot.chat(`/tpa ${tpaTarget}`);
                    }
                }, 5000);
            }
        });

        this.#bot.on('move', () => {
            this.#updatePosition();
        });

        this.#bot.on('respawn', () => {
            if (this.#bot.game?.dimension) {
                this.#currentWorld = this.#bot.game.dimension;
                this.emit('respawned', { world: this.#currentWorld });
            }
        });

        this.#bot.on('end', async (reason) => {
            this.#handleDisconnect('end', reason);
        });

        this.#bot.on('error', async (error) => {
            Logger.error('Minecraft bot error', { error: error.message });
            this.#handleDisconnect('error', error.message);
        });

        this.#bot.on('kicked', async (reason) => {
            Logger.warn('Kicked from server', { reason: reason.toString() });
            this.#handleDisconnect('kicked', reason.toString());
        });

        this.#bot.on('message', (message) => {
            this.emit('chatMessage', { message: message.toString() });
        });
    }

    #handleDisconnect(reason, details = '') {
        this.#safetyMonitor.detach();
        this.#bot = null;
        this.#currentWorld = 'Unknown';
        this.#currentCoords = { x: 0, y: 0, z: 0 };

        this.#connectionState.forceState(ConnectionState.DISCONNECTED, { reason, details });
        this.emit('disconnected', { reason, details });

        if (this.#shouldReconnect) {
            this.#scheduleReconnect();
        }
    }

    #scheduleReconnect() {
        if (!this.#shouldReconnect) return;
        
        if (this.#reconnectAttempts >= this.#config.reconnect.maxAttempts) {
            Logger.error('Max reconnect attempts reached');
            this.#shouldReconnect = false;
            this.emit('reconnectFailed');
            return;
        }

        this.#reconnectAttempts++;
        this.#connectionState.forceState(ConnectionState.RECONNECTING);

        const delay = Math.min(
            this.#config.reconnect.baseDelay * 
                Math.pow(this.#config.reconnect.backoffMultiplier, this.#reconnectAttempts - 1),
            this.#config.reconnect.maxDelay
        );

        Logger.info(`Scheduling reconnect in ${delay}ms`, { 
            attempt: this.#reconnectAttempts 
        });

        this.emit('reconnecting', { 
            attempt: this.#reconnectAttempts, 
            delay,
            maxAttempts: this.#config.reconnect.maxAttempts
        });

        this.#reconnectTimeout = setTimeout(async () => {
            if (this.#shouldReconnect && !this.#connectionState.isConnected()) {
                this.#connectionState.forceState(ConnectionState.DISCONNECTED);
                await this.connect();
            }
        }, delay);
    }

    disconnect(reason = 'User requested') {
        this.#shouldReconnect = false;
        this.#reconnectAttempts = 0;

        if (this.#reconnectTimeout) {
            clearTimeout(this.#reconnectTimeout);
            this.#reconnectTimeout = null;
        }

        if (this.#bot) {
            this.#safetyMonitor.detach();
            this.#bot.quit();
            this.#bot = null;
        }

        this.#connectionState.forceState(ConnectionState.DISCONNECTED, { reason });
        this.emit('disconnected', { reason, userRequested: true });
    }

    #updatePosition() {
        if (this.#bot?.entity?.position) {
            this.#currentCoords = {
                x: this.#bot.entity.position.x,
                y: this.#bot.entity.position.y,
                z: this.#bot.entity.position.z
            };
        }
    }

    #setupAuthCapture() {
        const originalStderrWrite = process.stderr.write.bind(process.stderr);
        
        process.stderr.write = (chunk, encoding, callback) => {
            const message = chunk.toString();

            if (message.includes('Chunk size') || message.includes('partial packet')) {
                return true;
            }

            if (message.includes('microsoft.com/link') && message.includes('use the code')) {
                this.#extractAuthDetails(message);
            }

            return originalStderrWrite(chunk, encoding, callback);
        };
    }

    #extractAuthDetails(message) {
        const urlMatch = message.match(/https:\/\/[^\s]+/);
        const codeMatch = message.match(/code ([A-Z0-9]+)/);

        if (urlMatch && codeMatch) {
            const baseUrl = urlMatch[0];
            const code = codeMatch[1];
            const authUrlWithOtp = baseUrl.includes('?') 
                ? `${baseUrl}&otc=${code}` 
                : `${baseUrl}?otc=${code}`;

            this.#authData = { url: authUrlWithOtp, code };
            this.#connectionState.transition(ConnectionState.AUTHENTICATING);
            this.emit('authRequired', this.#authData);
        }
    }

    sendMessage(message) {
        if (!this.#bot || !this.#connectionState.isConnected()) {
            throw new ConnectionError('Bot is not connected');
        }
        this.#bot.chat(message);
    }

    get isConnected() {
        return this.#connectionState.isConnected();
    }

    get state() {
        return this.#connectionState.current;
    }

    get username() {
        return this.#bot?.username || null;
    }

    get world() {
        return this.#currentWorld;
    }

    get position() {
        return { ...this.#currentCoords };
    }

    get health() {
        return this.#safetyMonitor.currentHealth;
    }

    get authData() {
        return this.#authData ? { ...this.#authData } : null;
    }

    get reconnectInfo() {
        return {
            attempts: this.#reconnectAttempts,
            maxAttempts: this.#config.reconnect.maxAttempts,
            shouldReconnect: this.#shouldReconnect
        };
    }

    get bot() {
        return this.#bot;
    }
}

// ============================================================================
// DISCORD BOT MANAGER
// ============================================================================

class DiscordBotManager extends EventEmitter {
    #config;
    #client;
    #controlMessage = null;
    #commands = [];
    #rateLimiter;
    #minecraftManager;
    #lastAuthUser = null;
    #authInteraction = null;

    constructor(config) {
        super();
        this.#config = config;
        this.#rateLimiter = new RateLimiter(5, 1);

        this.#client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages
            ]
        });

        this.#setupCommands();
        this.#setupEvents();
    }

    setMinecraftManager(minecraftManager) {
        this.#minecraftManager = minecraftManager;
        this.#setupMinecraftEvents();
    }

    #setupMinecraftEvents() {
        this.#minecraftManager.on('stateChange', () => this.#updateControlMessage());
        this.#minecraftManager.on('connected', () => this.#handleMinecraftConnected());
        this.#minecraftManager.on('disconnected', () => this.#updateControlMessage());
        this.#minecraftManager.on('authRequired', (data) => this.#handleAuthRequired(data));
        this.#minecraftManager.on('safetyAlert', (data) => this.#handleSafetyAlert(data));
        this.#minecraftManager.on('reconnecting', () => this.#updateControlMessage());
    }

    async #handleMinecraftConnected() {
        if (this.#authInteraction) {
            try {
                const embed = new EmbedBuilder()
                    .setTitle('✅ Authentication Successful')
                    .setDescription(`Connected as **${this.#minecraftManager.username}**!`)
                    .setColor('#00ff00')
                    .setTimestamp();

                await this.#authInteraction.editReply({ embeds: [embed] });
                this.#authInteraction = null;
            } catch (error) {
                Logger.error('Failed to update auth interaction', { error: error.message });
            }
        }
        
        this.#updateActivity();
        await this.#updateControlMessage();
    }

    async #handleAuthRequired(authData) {
        if (!this.#authInteraction) return;

        try {
            const embed = new EmbedBuilder()
                .setTitle('🔐 Microsoft Authentication Required')
                .setDescription('Please authenticate to connect the Minecraft bot.')
                .addFields(
                    { 
                        name: '🔗 Authentication Link', 
                        value: `[Click here to authenticate](${authData.url})`, 
                        inline: false 
                    },
                    { 
                        name: '🔑 Code (if needed)', 
                        value: `\`${authData.code}\``, 
                        inline: false 
                    },
                    { 
                        name: '⏳ Status', 
                        value: 'Waiting for authentication...', 
                        inline: false 
                    }
                )
                .setColor('#ff9900')
                .setTimestamp();

            await this.#authInteraction.editReply({ embeds: [embed] });
            await this.#updateControlMessage();
        } catch (error) {
            Logger.error('Failed to send auth message', { error: error.message });
        }
    }

    async #handleSafetyAlert(data) {
        if (!this.#lastAuthUser) return;

        try {
            const embed = this.#createSafetyAlertEmbed(data);
            const isUrgent = ['critical-health', 'threat-detected'].includes(data.type);
            
            await this.#lastAuthUser.send({
                content: isUrgent ? '🚨 **URGENT SAFETY ALERT** 🚨' : '⚠️ **Safety Alert**',
                embeds: [embed]
            });
        } catch (error) {
            Logger.warn('Failed to send safety alert DM', { error: error.message });
            try {
                const channel = await this.#client.channels.fetch(this.#config.discord.channelId);
                if (channel) {
                    await channel.send({
                        content: `⚠️ Safety Alert for ${this.#lastAuthUser?.tag || 'user'}: **${data.type}**`
                    });
                }
            } catch (fallbackError) {
                Logger.error('Failed to send safety alert to channel', { error: fallbackError.message });
            }
        }
    }

    #createSafetyAlertEmbed(data) {
        const position = this.#minecraftManager.position;
        const world = this.#minecraftManager.world;
        const health = this.#minecraftManager.health;

        let title, description, color;

        switch (data.type) {
            case 'critical-health':
                title = '🚨 CRITICAL HEALTH - AUTO DISCONNECT';
                description = `**Took ${data.damage} damage! Health: ${data.health}/20**\n\n**Action:** Auto-disconnected for safety!`;
                color = '#8B0000';
                break;
            case 'threat-detected':
                const threatList = data.threats.map(t => `${t.username} (${t.distance}m)`).join(', ');
                title = '🚨 THREAT DETECTED - AUTO DISCONNECT';
                description = `**Untrusted player(s) within 20 blocks:**\n${threatList}\n\n**Action:** Auto-disconnected!`;
                color = '#ff0000';
                break;
            case 'damage-taken':
                title = '🩸 Damage Taken';
                description = `**Took ${data.damage} damage!**\nHealth: ${data.previousHealth} → ${data.health}`;
                color = '#ff0000';
                break;
            case 'low-health':
                title = '💀 Critical Health Alert';
                description = `**DANGER: Health critically low at ${data.health}/20!**`;
                color = '#8B0000';
                break;
            case 'players-nearby':
                const playerList = data.players.map(p => {
                    const icon = p.isTrusted ? '✅' : p.isBlocked ? '🚫' : '⚠️';
                    return `${icon} **${p.username}** (${p.distance}m)`;
                }).join('\n');
                title = '⚠️ Player Proximity Alert';
                description = `**Players detected nearby:**\n${playerList}`;
                color = '#ff9900';
                break;
            case 'spawn-area-players':
                title = '🔄 Players at Spawn';
                description = `**Players detected at spawn (likely server restart)**\nNo disconnect (spawn protection active)`;
                color = '#00bfff';
                break;
            default:
                title = '⚠️ Safety Alert';
                description = JSON.stringify(data);
                color = '#ffff00';
        }

        return new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(color)
            .addFields(
                { 
                    name: '📍 Location', 
                    value: `\`X: ${Math.round(position.x)}, Y: ${Math.round(position.y)}, Z: ${Math.round(position.z)}\``, 
                    inline: true 
                },
                { name: '🌍 World', value: `\`${world}\``, inline: true },
                { name: '❤️ Health', value: `\`${health}/20\``, inline: true },
                { name: '⏰ Time', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'AFK Bot Safety System' });
    }

    #setupCommands() {
        this.#commands = [
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
                .setDescription('Disconnect the bot from the Minecraft server'),
            new SlashCommandBuilder()
                .setName('safety')
                .setDescription('Toggle or configure safety features')
                .addStringOption(option =>
                    option.setName('action')
                        .setDescription('Action to perform')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Status', value: 'status' },
                            { name: 'Enable', value: 'enable' },
                            { name: 'Disable', value: 'disable' }
                        )
                )
        ];
    }

    #setupEvents() {
        this.#client.once('ready', async () => {
            Logger.success(`Discord bot ready as ${this.#client.user.tag}`);
            await this.#registerCommands();
            await this.#setupControlMessage();
            this.#updateActivity();
        });

        this.#client.on('interactionCreate', async (interaction) => {
            if (interaction.isButton()) {
                await this.#handleButtonInteraction(interaction);
            } else if (interaction.isChatInputCommand()) {
                await this.#handleCommandInteraction(interaction);
            }
        });
    }

    async #handleButtonInteraction(interaction) {
        if (interaction.message.id !== this.#controlMessage?.id) return;

        if (!this.#rateLimiter.tryConsume()) {
            await interaction.reply({
                content: '⏳ Please wait before trying again.',
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        if (interaction.customId === 'connect') {
            this.#lastAuthUser = interaction.user;
            this.#authInteraction = interaction;

            const embed = new EmbedBuilder()
                .setTitle('🔐 Microsoft Authentication Required')
                .setDescription('Connecting to Minecraft server...')
                .addFields({ name: '⏳ Status', value: 'Initializing connection...', inline: false })
                .setColor('#ff9900')
                .setTimestamp();

            await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
            this.#updateActivity('⏳ Connecting...', ActivityType.Watching);
            
            await this.#minecraftManager.connect();

        } else if (interaction.customId === 'disconnect') {
            this.#authInteraction = null;
            this.#minecraftManager.disconnect('User requested via button');
            this.#updateActivity('🔴 Standby', ActivityType.Watching);
            await this.#updateControlMessage();

            await interaction.reply({
                content: '✅ Bot disconnected from Minecraft server!',
                flags: [MessageFlags.Ephemeral]
            });
        }
    }

    async #handleCommandInteraction(interaction) {
        if (interaction.channelId !== this.#config.discord.channelId) {
            await interaction.reply({
                content: '❌ This bot can only be used in the designated channel!',
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        if (!this.#rateLimiter.tryConsume()) {
            await interaction.reply({
                content: '⏳ Please wait before trying again.',
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        try {
            const handler = this.#commandHandlers[interaction.commandName];
            if (handler) {
                await handler.call(this, interaction);
            } else {
                await interaction.reply({
                    content: '❌ Unknown command!',
                    flags: [MessageFlags.Ephemeral]
                });
            }
        } catch (error) {
            Logger.error('Command error', { 
                command: interaction.commandName, 
                error: error.message 
            });

            const errorMessage = 'There was an error executing this command!';
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: errorMessage, flags: [MessageFlags.Ephemeral] });
            } else {
                await interaction.reply({ content: errorMessage, flags: [MessageFlags.Ephemeral] });
            }
        }
    }

    // ========================================================================
    // COMMAND HANDLERS - All responses are ephemeral (only visible to user)
    // ========================================================================

    #commandHandlers = {
        async message(interaction) {
            const text = interaction.options.getString('text');

            if (!this.#minecraftManager.isConnected) {
                await interaction.reply({
                    content: '❌ Bot is not connected!',
                    flags: [MessageFlags.Ephemeral]
                });
                return;
            }

            try {
                this.#minecraftManager.sendMessage(text);
                await interaction.reply({
                    content: `✅ Message sent: "${text}"`,
                    flags: [MessageFlags.Ephemeral]
                });
            } catch (error) {
                await interaction.reply({
                    content: '❌ Failed to send message!',
                    flags: [MessageFlags.Ephemeral]
                });
            }
        },

        async shards(interaction) {
            if (!this.#minecraftManager.isConnected) {
                await interaction.reply({
                    content: '❌ Bot is not connected!',
                    flags: [MessageFlags.Ephemeral]
                });
                return;
            }

            // Defer with ephemeral flag for slow responses
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            const bot = this.#minecraftManager.bot;
            let responded = false;

            const messageListener = async (message) => {
                const text = message.toString();
                if (text.toLowerCase().includes('shard')) {
                    responded = true;
                    bot.removeListener('message', messageListener);
                    
                    const embed = new EmbedBuilder()
                        .setTitle('💎 Shard Balance')
                        .setDescription(text.substring(0, 1000))
                        .setColor('#9d4edd')
                        .setTimestamp();

                    await interaction.editReply({ embeds: [embed] });
                }
            };

            bot.on('message', messageListener);
            bot.chat('/shards');

            setTimeout(() => {
                bot.removeListener('message', messageListener);
                if (!responded) {
                    interaction.editReply({
                        content: '⏰ No response from server.'
                    });
                }
            }, 10000);
        },

        async status(interaction) {
            const embed = new EmbedBuilder()
                .setTitle('🤖 Bot Status')
                .setColor(this.#minecraftManager.isConnected ? '#00ff00' : '#ff0000')
                .addFields(
                    { 
                        name: '🎮 Minecraft', 
                        value: this.#minecraftManager.isConnected ? '✅ Connected' : '❌ Disconnected', 
                        inline: true 
                    },
                    { 
                        name: '💬 Discord', 
                        value: '✅ Connected', 
                        inline: true 
                    },
                    { 
                        name: '🌐 Web Server', 
                        value: this.#config.webServer.enabled ? `✅ Port ${this.#config.webServer.port}` : '❌ Disabled', 
                        inline: true 
                    }
                );

            if (this.#minecraftManager.isConnected) {
                const pos = this.#minecraftManager.position;
                embed.addFields(
                    { name: '👤 Username', value: this.#minecraftManager.username || 'Unknown', inline: true },
                    { name: '🌍 World', value: this.#minecraftManager.world, inline: true },
                    { 
                        name: '📍 Position', 
                        value: `X: ${Math.round(pos.x)}, Y: ${Math.round(pos.y)}, Z: ${Math.round(pos.z)}`, 
                        inline: true 
                    },
                    {
                        name: '❤️ Health',
                        value: `${this.#minecraftManager.health}/20`,
                        inline: true
                    }
                );
            }

            embed.setTimestamp();

            await interaction.reply({ 
                embeds: [embed], 
                flags: [MessageFlags.Ephemeral] 
            });
        },

        async connect(interaction) {
            if (this.#minecraftManager.isConnected) {
                await interaction.reply({
                    content: '✅ Bot is already connected!',
                    flags: [MessageFlags.Ephemeral]
                });
                return;
            }

            this.#lastAuthUser = interaction.user;
            this.#authInteraction = interaction;

            const embed = new EmbedBuilder()
                .setTitle('🔐 Connecting to Minecraft')
                .setDescription('Initializing connection...')
                .addFields({ name: '⏳ Status', value: 'Please wait...', inline: false })
                .setColor('#ff9900')
                .setTimestamp();

            await interaction.reply({
                embeds: [embed],
                flags: [MessageFlags.Ephemeral]
            });

            await this.#minecraftManager.connect();
        },

        async disconnect(interaction) {
            if (!this.#minecraftManager.isConnected) {
                await interaction.reply({
                    content: '❌ Bot is not connected!',
                    flags: [MessageFlags.Ephemeral]
                });
                return;
            }

            this.#minecraftManager.disconnect('User requested via command');
            await this.#updateControlMessage();

            await interaction.reply({
                content: '✅ Bot disconnected!',
                flags: [MessageFlags.Ephemeral]
            });
        },

        async safety(interaction) {
            const action = interaction.options.getString('action');
            const config = Config.getInstance();

            switch (action) {
                case 'status':
                    const embed = new EmbedBuilder()
                        .setTitle('🛡️ Safety Configuration')
                        .setColor(config.safety.enabled ? '#00ff00' : '#ff0000')
                        .addFields(
                            { name: 'Status', value: config.safety.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                            { name: 'Proximity Radius', value: `${config.safety.proximityRadius} blocks`, inline: true },
                            { name: 'Min Health Alert', value: `${config.safety.minHealth}/20`, inline: true },
                            { name: 'Auto-Disconnect Health', value: `${config.safety.autoDisconnectHealth}/20`, inline: true },
                            { name: 'Auto-Disconnect on Threat', value: config.safety.autoDisconnectOnThreat ? 'Yes' : 'No', inline: true },
                            { name: 'Spawn Protection Radius', value: `${config.safety.spawnProtectionRadius} blocks`, inline: true }
                        )
                        .setTimestamp();
                    await interaction.reply({ 
                        embeds: [embed], 
                        flags: [MessageFlags.Ephemeral] 
                    });
                    break;

                case 'enable':
                    config.safety.enabled = true;
                    await this.#updateControlMessage();
                    await interaction.reply({ 
                        content: '✅ Safety features enabled!', 
                        flags: [MessageFlags.Ephemeral] 
                    });
                    break;

                case 'disable':
                    config.safety.enabled = false;
                    await this.#updateControlMessage();
                    await interaction.reply({ 
                        content: '❌ Safety features disabled!', 
                        flags: [MessageFlags.Ephemeral] 
                    });
                    break;
            }
        }
    };

    async #registerCommands() {
        try {
            const rest = new REST({ version: '10' }).setToken(this.#config.discord.token);
            
            await rest.put(
                Routes.applicationCommands(this.#client.user.id),
                { body: this.#commands.map(cmd => cmd.toJSON()) }
            );
            
            Logger.success('Slash commands registered');
        } catch (error) {
            Logger.error('Failed to register commands', { error: error.message });
        }
    }

    async #setupControlMessage() {
        try {
            const channel = await this.#client.channels.fetch(this.#config.discord.channelId);
            if (!channel) {
                Logger.error('Control channel not found');
                return;
            }

            const embed = this.#createControlEmbed();
            const row = this.#createControlButtons();

            this.#controlMessage = await channel.send({
                embeds: [embed],
                components: [row]
            });
        } catch (error) {
            Logger.error('Failed to setup control message', { error: error.message });
        }
    }

    async #updateControlMessage() {
        if (!this.#controlMessage) return;

        try {
            const embed = this.#createControlEmbed();
            const row = this.#createControlButtons();

            await this.#controlMessage.edit({
                embeds: [embed],
                components: [row]
            });
        } catch (error) {
            Logger.error('Failed to update control message', { error: error.message });
        }
    }

    #createControlEmbed() {
        const isConnected = this.#minecraftManager?.isConnected || false;
        const state = this.#minecraftManager?.state || ConnectionState.DISCONNECTED;
        const config = Config.getInstance();

        const statusColor = isConnected ? '#00ff00' : 
            state === ConnectionState.CONNECTING || state === ConnectionState.RECONNECTING 
                ? '#ff9900' : '#ff0000';

        const embed = new EmbedBuilder()
            .setTitle('🎮 Minecraft AFK Bot')
            .setColor(statusColor)
            .addFields(
                { name: '🖥️ Server', value: `\`${config.minecraft.host}\``, inline: true },
                { name: '🔗 Status', value: this.#getStatusText(), inline: true },
                { 
                    name: '🛡️ Safety', 
                    value: config.safety.enabled 
                        ? (isConnected ? '✅ Active' : '⏸️ Standby') 
                        : '❌ Disabled', 
                    inline: true 
                }
            );

        if (isConnected && this.#minecraftManager) {
            const pos = this.#minecraftManager.position;
            embed.addFields(
                { name: '👤 Player', value: `\`${this.#minecraftManager.username}\``, inline: true },
                { name: '🌍 World', value: `\`${this.#minecraftManager.world}\``, inline: true },
                { name: '❤️ Health', value: `\`${this.#minecraftManager.health}/20\``, inline: true },
                { 
                    name: '📍 Position', 
                    value: `\`${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)}\``, 
                    inline: false 
                }
            );
        }

        const reconnectInfo = this.#minecraftManager?.reconnectInfo;
        if (reconnectInfo?.attempts > 0 && reconnectInfo?.shouldReconnect) {
            embed.addFields({
                name: '🔄 Reconnecting',
                value: `Attempt ${reconnectInfo.attempts}/${reconnectInfo.maxAttempts}`,
                inline: true
            });
        }

        const authData = this.#minecraftManager?.authData;
        if (authData) {
            embed.addFields({
                name: '🔑 Auth Required',
                value: `[Click here](${authData.url}) | Code: \`${authData.code}\``,
                inline: false
            });
        }

        embed.setTimestamp()
            .setFooter({ text: 'Use buttons below or slash commands to control the bot' });

        return embed;
    }

    #getStatusText() {
        const state = this.#minecraftManager?.state || ConnectionState.DISCONNECTED;
        const authData = this.#minecraftManager?.authData;
        const reconnectInfo = this.#minecraftManager?.reconnectInfo;

        if (authData) {
            return '⏳ Waiting for authentication...';
        }

        switch (state) {
            case ConnectionState.CONNECTED:
                return `✅ Connected as ${this.#minecraftManager.username}`;
            case ConnectionState.CONNECTING:
                return '⏳ Connecting...';
            case ConnectionState.AUTHENTICATING:
                return '🔐 Authenticating...';
            case ConnectionState.RECONNECTING:
                return `🔄 Reconnecting (${reconnectInfo?.attempts || 0}/${reconnectInfo?.maxAttempts || 0})`;
            case ConnectionState.ERROR:
                return '❌ Error occurred';
            default:
                return '❌ Disconnected';
        }
    }

    #createControlButtons() {
        return new ActionRowBuilder()
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
    }

    #updateActivity(customStatus = null, activityType = ActivityType.Playing) {
        if (!this.#client?.user) return;

        try {
            let status = customStatus;

            if (!customStatus) {
                if (this.#minecraftManager?.isConnected) {
                    const config = Config.getInstance();
                    const safetyIcon = config.safety.enabled ? '🛡️ ' : '';
                    status = `${safetyIcon}AFK on ${config.minecraft.host}`;
                    activityType = ActivityType.Playing;
                } else if (this.#minecraftManager?.authData) {
                    status = '🔐 Waiting for auth...';
                    activityType = ActivityType.Watching;
                } else if (this.#minecraftManager?.state === ConnectionState.CONNECTING) {
                    status = '⏳ Connecting...';
                    activityType = ActivityType.Watching;
                } else {
                    status = '🔴 Standby';
                    activityType = ActivityType.Watching;
                }
            }

            this.#client.user.setActivity(status, { type: activityType });
        } catch (error) {
            Logger.error('Failed to update activity', { error: error.message });
        }
    }

    async login() {
        await this.#client.login(this.#config.discord.token);
    }

    async shutdown() {
        if (this.#client) {
            this.#client.destroy();
        }
    }

    get client() {
        return this.#client;
    }
}

// ============================================================================
// WEB SERVER MANAGER
// ============================================================================

class WebServerManager {
    #config;
    #app;
    #server;
    #minecraftManager;
    #discordManager;
    #rateLimiter;

    constructor(config) {
        this.#config = config;
        this.#rateLimiter = new RateLimiter(20, 5);
        this.#app = express();
        this.#setupMiddleware();
    }

    setManagers(minecraftManager, discordManager) {
        this.#minecraftManager = minecraftManager;
        this.#discordManager = discordManager;
        this.#setupRoutes();
    }

    #setupMiddleware() {
        this.#app.use(express.json());
        this.#app.use(express.static('public'));
        
        this.#app.use((req, res, next) => {
            if (!this.#rateLimiter.tryConsume()) {
                return res.status(429).json({
                    success: false,
                    message: 'Too many requests. Please slow down.'
                });
            }
            next();
        });

        this.#app.use((req, res, next) => {
            Logger.debug(`${req.method} ${req.path}`, { ip: req.ip });
            next();
        });
    }

    #setupRoutes() {
        // Health check
        this.#app.get('/health', (req, res) => {
            res.json({
                status: 'ok',
                timestamp: new Date().toISOString(),
                minecraft: {
                    connected: this.#minecraftManager?.isConnected || false,
                    username: this.#minecraftManager?.username || null,
                    world: this.#minecraftManager?.world || 'Unknown',
                    coordinates: this.#minecraftManager?.position || { x: 0, y: 0, z: 0 }
                },
                discord: {
                    connected: !!this.#discordManager?.client?.readyTimestamp,
                    username: this.#discordManager?.client?.user?.tag || null
                }
            });
        });

        // Detailed status
        this.#app.get('/status', (req, res) => {
            res.json({
                minecraft: {
                    connected: this.#minecraftManager?.isConnected || false,
                    state: this.#minecraftManager?.state || 'unknown',
                    username: this.#minecraftManager?.username || null,
                    server: `${this.#config.minecraft.host}:${this.#config.minecraft.port}`,
                    version: this.#config.minecraft.version,
                    world: this.#minecraftManager?.world || 'Unknown',
                    coordinates: this.#minecraftManager?.position || { x: 0, y: 0, z: 0 },
                    health: this.#minecraftManager?.health || 0,
                    reconnect: this.#minecraftManager?.reconnectInfo || {},
                    authRequired: !!this.#minecraftManager?.authData
                },
                discord: {
                    connected: !!this.#discordManager?.client?.readyTimestamp,
                    username: this.#discordManager?.client?.user?.tag || null,
                    guildCount: this.#discordManager?.client?.guilds?.cache?.size || 0
                },
                safety: this.#config.safety,
                uptime: process.uptime(),
                memory: process.memoryUsage()
            });
        });

        // Connect endpoint
        this.#app.post('/connect', async (req, res) => {
            if (this.#minecraftManager?.isConnected) {
                return res.json({ success: false, message: 'Bot already connected' });
            }

            await this.#minecraftManager?.connect();
            res.json({ success: true, message: 'Connection initiated' });
        });

        // Disconnect endpoint
        this.#app.post('/disconnect', (req, res) => {
            this.#minecraftManager?.disconnect('API request');
            res.json({ success: true, message: 'Bot disconnected' });
        });

        // Send chat message
        this.#app.post('/chat', (req, res) => {
            const { message } = req.body;

            if (!this.#minecraftManager?.isConnected) {
                return res.json({ success: false, message: 'Bot not connected' });
            }

            if (!message || typeof message !== 'string') {
                return res.json({ success: false, message: 'Invalid message' });
            }

            try {
                this.#minecraftManager.sendMessage(message);
                res.json({ success: true, message: 'Message sent' });
            } catch (error) {
                res.json({ success: false, message: error.message });
            }
        });

        // Safety toggle
        this.#app.post('/safety', (req, res) => {
            const { enabled } = req.body;
            const config = Config.getInstance();

            if (typeof enabled === 'boolean') {
                config.safety.enabled = enabled;
                res.json({
                    success: true,
                    message: `Safety ${enabled ? 'enabled' : 'disabled'}`,
                    safety: config.safety
                });
            } else {
                res.json({ success: false, message: 'Invalid request. Use { "enabled": true/false }' });
            }
        });

        this.#app.get('/safety', (req, res) => {
            const config = Config.getInstance();
            res.json({
                success: true,
                safety: config.safety
            });
        });

        // API info
        this.#app.get('/', (req, res) => {
            res.json({
                name: 'Minecraft Discord Bot API',
                version: '2.0.0',
                endpoints: {
                    'GET /': 'API information',
                    'GET /health': 'Health check',
                    'GET /status': 'Detailed status',
                    'POST /connect': 'Connect to Minecraft',
                    'POST /disconnect': 'Disconnect from Minecraft',
                    'POST /chat': 'Send chat message',
                    'GET /safety': 'Get safety config',
                    'POST /safety': 'Toggle safety ({"enabled": true/false})'
                },
                minecraft: {
                    server: `${this.#config.minecraft.host}:${this.#config.minecraft.port}`,
                    connected: this.#minecraftManager?.isConnected || false
                }
            });
        });

        // Error handler
        this.#app.use((error, req, res, next) => {
            Logger.error('Web server error', { error: error.message, path: req.path });
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        });

        // 404 handler
        this.#app.use((req, res) => {
            res.status(404).json({
                success: false,
                message: 'Endpoint not found'
            });
        });
    }

    async start() {
        if (!this.#config.webServer.enabled) {
            Logger.info('Web server disabled');
            return;
        }

        return new Promise((resolve, reject) => {
            this.#server = http.createServer(this.#app);
            
            this.#server.listen(
                this.#config.webServer.port, 
                this.#config.webServer.host,
                (error) => {
                    if (error) {
                        reject(error);
                    } else {
                        Logger.success(`Web server listening on ${this.#config.webServer.host}:${this.#config.webServer.port}`);
                        resolve();
                    }
                }
            );
        });
    }

    async shutdown() {
        if (this.#server) {
            return new Promise((resolve) => {
                this.#server.close(() => resolve());
            });
        }
    }
}

// ============================================================================
// APPLICATION ORCHESTRATOR
// ============================================================================

class Application {
    #config;
    #discordManager;
    #minecraftManager;
    #webServerManager;
    #safetyMonitor;
    #statusInterval;

    constructor() {
        this.#config = Config.getInstance();
    }

    async start() {
        Logger.showBanner();
        Logger.info('Starting Doggo Minecraft Bot v2.0...');

        try {
            this.#config.validate();
            Logger.success('Configuration validated');

            this.#safetyMonitor = new SafetyMonitor(this.#config);
            this.#minecraftManager = new MinecraftBotManager(this.#config, this.#safetyMonitor);
            this.#discordManager = new DiscordBotManager(this.#config);
            this.#webServerManager = new WebServerManager(this.#config);

            this.#discordManager.setMinecraftManager(this.#minecraftManager);
            this.#webServerManager.setManagers(this.#minecraftManager, this.#discordManager);

            const results = await this.#startServices();
            this.#showStartupStatus(results);

            this.#statusInterval = setInterval(() => {
                if (this.#minecraftManager.isConnected) {
                    // Periodic updates handled by event system
                }
            }, 30000);

            return true;
        } catch (error) {
            Logger.fatal('Startup failed', { error: error.message });
            throw error;
        }
    }

    async #startServices() {
        const results = [];

        try {
            await this.#discordManager.login();
            results.push({ 
                name: 'Discord Bot', 
                status: true, 
                details: this.#discordManager.client?.user?.tag 
            });
        } catch (error) {
            results.push({ name: 'Discord Bot', status: false, details: error.message });
        }

        try {
            await this.#webServerManager.start();
            results.push({ 
                name: 'Web Server', 
                status: true, 
                details: `http://${this.#config.webServer.host}:${this.#config.webServer.port}` 
            });
        } catch (error) {
            results.push({ name: 'Web Server', status: false, details: error.message });
        }

        results.push({ 
            name: 'Minecraft Bot', 
            status: true, 
            details: 'Ready (awaiting connection)' 
        });

        return results;
    }

    #showStartupStatus(services) {
        console.log('\n' + '═'.repeat(60));
        console.log('                    SERVICE STATUS');
        console.log('═'.repeat(60));
        
        for (const service of services) {
            const icon = service.status ? '✅' : '❌';
            const status = service.status ? 'ONLINE' : 'FAILED';
            console.log(`  ${icon} ${service.name.padEnd(20)} ${status.padEnd(10)} ${service.details || ''}`);
        }
        
        console.log('═'.repeat(60) + '\n');

        const allOnline = services.every(s => s.status);
        if (!allOnline) {
            throw new Error('Some services failed to start');
        }
    }

    async shutdown() {
        Logger.info('Shutting down...');

        if (this.#statusInterval) {
            clearInterval(this.#statusInterval);
        }

        try {
            if (this.#minecraftManager) {
                this.#minecraftManager.disconnect('Application shutdown');
            }

            if (this.#discordManager) {
                await this.#discordManager.shutdown();
            }

            if (this.#webServerManager) {
                await this.#webServerManager.shutdown();
            }

            Logger.success('Shutdown complete');
        } catch (error) {
            Logger.error('Error during shutdown', { error: error.message });
        }
    }
}

// ============================================================================
// ENTRY POINT
// ============================================================================

const app = new Application();

app.start().catch((error) => {
    Logger.fatal('Application failed to start', { error: error.message });
    process.exit(1);
});

// ============================================================================
// PROCESS MANAGEMENT
// ============================================================================

const gracefulShutdown = async (signal) => {
    Logger.warn(`Received ${signal}, initiating graceful shutdown...`);
    try {
        await app.shutdown();
        process.exit(0);
    } catch (error) {
        Logger.error('Error during shutdown', { error: error.message });
        process.exit(1);
    }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
    Logger.fatal('Uncaught exception', { error: error.message, stack: error.stack });
});

process.on('unhandledRejection', (reason, promise) => {
    Logger.error('Unhandled rejection', { reason: String(reason) });
});
