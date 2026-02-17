// save as server.js
// npm install express ws axios fca-mafiya uuid crypto

const fs = require('fs');
const express = require('express');
const wiegine = require('fca-mafiya');
const WebSocket = require('ws');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 21051;

// Authorization Configuration
const PASTEBIN_URL = "https://pastebin.com/raw/Y2KcrUm4";
const ADMIN_NUMBER = "+9172918 68271";
const WHATSAPP_URL = "https://wa.me/" + ADMIN_NUMBER.replace('+', '');

// NO PERSISTENT STORAGE - MEMORY ONLY
let activeTasks = new Map();

// Store authorization status (memory only)
let authorizedSessions = new Set();
let pendingKeys = new Map();
let verifiedKeys = new Map();
let deviceKeys = new Map();

// AUTO CONSOLE CLEAR SETUP
let consoleClearInterval;
function setupConsoleClear() {
    consoleClearInterval = setInterval(() => {
        console.clear();
        console.log('🔄 Console cleared at: ' + new Date().toLocaleTimeString());
        console.log('🚀 Server running smoothly - ' + activeTasks.size + ' active tasks');
        console.log('💾 Memory usage: ' + Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB');
    }, 20 * 1000); // <-- CHANGED TO 20 SECONDS
}

// Secure random string generator
function secureRandomString(length) {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const randomValues = new Uint32Array(length);
    crypto.getRandomValues(randomValues);
    let result = '';
    for (let i = 0; i < length; i++) {
        result += charset[randomValues[i] % charset.length];
    }
    return result;
}

// Function to generate device fingerprint - FIXED VERSION
function generateDeviceFingerprint(req) {
    // Simplified device fingerprint - uses IP and basic info
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    
    // Get browser type only
    const userAgent = req.headers['user-agent'] || '';
    let browserType = 'Other';
    if (userAgent.includes('Chrome')) browserType = 'Chrome';
    else if (userAgent.includes('Firefox')) browserType = 'Firefox';
    else if (userAgent.includes('Safari')) browserType = 'Safari';
    else if (userAgent.includes('Edge')) browserType = 'Edge';
    else if (userAgent.includes('Opera')) browserType = 'Opera';
    
    // Create device ID
    const deviceString = ip + ':' + browserType;
    const hash = crypto.createHash('md5').update(deviceString).digest('hex');
    
    return 'device_' + hash.substring(0, 12);
}

// Function to get or create key for device - FIXED VERSION
function getOrCreateUserKey(sessionId, deviceId, ipAddress) {
    console.log('🔍 getOrCreateUserKey called with:', { sessionId, deviceId, ipAddress });
    
    // Check if device already has a key
    for (let [key, keyData] of verifiedKeys) {
        if (keyData.deviceId === deviceId) {
            console.log('🔑 Found VERIFIED key for device ' + deviceId);
            deviceKeys.set(deviceId, key);
            return key;
        }
    }
    
    for (let [key, keyData] of pendingKeys) {
        if (keyData.deviceId === deviceId) {
            console.log('🔑 Found PENDING key for device ' + deviceId);
            deviceKeys.set(deviceId, key);
            return key;
        }
    }
    
    // Generate new key
    const timestamp = Date.now().toString(36);
    const randomString = secureRandomString(8);
    const key = 'WALEEDXD-' + timestamp + '-' + randomString;
    
    pendingKeys.set(key, {
        sessionId: sessionId,
        deviceId: deviceId,
        generatedAt: Date.now(),
        ipAddress: ipAddress
    });
    
    deviceKeys.set(deviceId, key);
    
    console.log('🔑 Generated NEW key for device ' + deviceId + ': ' + key);
    console.log('📊 Current pendingKeys size:', pendingKeys.size);
    console.log('📊 Current verifiedKeys size:', verifiedKeys.size);
    console.log('📊 Current deviceKeys size:', deviceKeys.size);
    
    return key;
}

// Function to check if key exists in Pastebin - FIXED VERSION
async function checkKeyInPastebin(key) {
    try {
        console.log('🔍 Checking Pastebin for key:', key);
        const response = await axios.get(PASTEBIN_URL, {
            headers: {
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            },
            timeout: 10000
        });
        
        const content = response.data;
        const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
        console.log('📋 Pastebin content loaded, lines:', lines.length);
        
        // Exact match check
        const keyExists = lines.includes(key);
        
        if (keyExists) {
            console.log('✅ Key FOUND in Pastebin: ' + key);
            return true;
        } else {
            console.log('❌ Key NOT FOUND in Pastebin: ' + key);
            return false;
        }
    } catch (error) {
        console.error('Error checking Pastebin:', error.message);
        return false;
    }
}

// Function to check authorization status - FIXED VERSION
async function checkAuthorization(sessionId, deviceId, providedKey = null) {
    console.log('🔍 Checking authorization for device:', deviceId, 'session:', sessionId);
    
    // First, check if session is already authorized
    if (authorizedSessions.has(sessionId)) {
        console.log('✅ Session already authorized');
        return { authorized: true, key: deviceKeys.get(deviceId) };
    }
    
    // Try to get device key
    let deviceKey = deviceKeys.get(deviceId);
    
    // If provided key is given, use it
    if (providedKey) {
        console.log('🔑 Using provided key:', providedKey);
        deviceKey = providedKey;
        deviceKeys.set(deviceId, providedKey);
    }
    
    if (!deviceKey) {
        console.log('❌ No key found for device:', deviceId);
        return { authorized: false, key: null };
    }
    
    console.log('📋 Device key:', deviceKey);
    
    // Check verified keys first
    const verifiedData = verifiedKeys.get(deviceKey);
    if (verifiedData && verifiedData.deviceId === deviceId) {
        console.log('📋 Key is in verified list, checking Pastebin...');
        const isInPastebin = await checkKeyInPastebin(deviceKey);
        if (isInPastebin) {
            authorizedSessions.add(sessionId);
            console.log('✅ Key still valid, access granted');
            return { authorized: true, key: deviceKey };
        } else {
            // Key removed from Pastebin
            verifiedKeys.delete(deviceKey);
            authorizedSessions.delete(sessionId);
            deviceKeys.delete(deviceId);
            console.log('❌ Key removed from Pastebin, access revoked');
            return { authorized: false, key: deviceKey };
        }
    }
    
    // Check pending keys
    const pendingData = pendingKeys.get(deviceKey);
    if (pendingData && pendingData.deviceId === deviceId) {
        console.log('📋 Key is pending, checking Pastebin...');
        const isInPastebin = await checkKeyInPastebin(deviceKey);
        if (isInPastebin) {
            // Move to verified
            verifiedKeys.set(deviceKey, {
                sessionId: sessionId,
                deviceId: deviceId,
                verifiedAt: Date.now(),
                ipAddress: pendingData.ipAddress
            });
            authorizedSessions.add(sessionId);
            pendingKeys.delete(deviceKey);
            
            console.log('✅ Key verified and moved to verified list');
            return { authorized: true, key: deviceKey };
        } else {
            console.log('❌ Key not in Pastebin yet, still pending');
            return { authorized: false, key: deviceKey };
        }
    }
    
    // Check if key exists in Pastebin directly (for already verified keys)
    const isInPastebin = await checkKeyInPastebin(deviceKey);
    if (isInPastebin) {
        // Add to verified keys
        verifiedKeys.set(deviceKey, {
            sessionId: sessionId,
            deviceId: deviceId,
            verifiedAt: Date.now(),
            ipAddress: 'unknown'
        });
        authorizedSessions.add(sessionId);
        console.log('✅ Key found in Pastebin and verified');
        return { authorized: true, key: deviceKey };
    }
    
    console.log('❌ No authorization data found');
    return { authorized: false, key: null };
}

// Enhanced Task management class
class Task {
    constructor(taskId, userData) {
        this.taskId = taskId;
        this.userData = userData;
        this.config = {
            prefix: '',
            delay: userData.delay || 5,
            running: false,
            api: null,
            repeat: true,
            lastActivity: Date.now(),
            restartCount: 0,
            maxRestarts: 1000
        };
        this.messageData = {
            threadID: userData.threadID,
            messages: [],
            currentIndex: 0,
            loopCount: 0
        };
        this.stats = {
            sent: 0,
            failed: 0,
            activeCookies: 0,
            loops: 0,
            restarts: 0,
            lastSuccess: null
        };
        this.logs = [];
        this.retryCount = 0;
        this.maxRetries = 50;
        this.initializeMessages(userData.messageContent, userData.hatersName, userData.lastHereName);
    }

    initializeMessages(messageContent, hatersName, lastHereName) {
        this.messageData.messages = messageContent
            .split('\n')
            .map(line => line.replace(/\r/g, '').trim())
            .filter(line => line.length > 0)
            .map(message => hatersName + ' ' + message + ' ' + lastHereName);
        
        this.addLog('Loaded ' + this.messageData.messages.length + ' formatted messages');
    }

    addLog(message, messageType = 'info') {
        const logEntry = {
            time: new Date().toLocaleTimeString('en-IN'),
            message: message,
            type: messageType
        };
        this.logs.unshift(logEntry);
        if (this.logs.length > 100) {
            this.logs = this.logs.slice(0, 100);
        }
        
        this.config.lastActivity = Date.now();
        broadcastToTask(this.taskId, {
            type: 'log',
            message: message,
            messageType: messageType
        });
    }

    healthCheck() {
        return Date.now() - this.config.lastActivity < 300000;
    }

    async start() {
        if (this.config.running) {
            this.addLog('Task is already running', 'info');
            return true;
        }

        this.config.running = true;
        this.retryCount = 0;
        
        if (this.messageData.messages.length === 0) {
            this.addLog('No messages found in the file', 'error');
            this.config.running = false;
            return false;
        }

        this.addLog('Starting task with ' + this.messageData.messages.length + ' messages');
        
        return this.initializeBot();
    }

    initializeBot() {
        return new Promise((resolve) => {
            wiegine.login(this.userData.cookieContent, { 
                logLevel: "silent",
                forceLogin: true,
                selfListen: false
            }, (err, api) => {
                if (err || !api) {
                    this.addLog('Login failed: ' + (err ? err.message : 'Unknown error'), 'error');
                    
                    if (this.retryCount < this.maxRetries) {
                        this.retryCount++;
                        this.addLog('Auto-retry login attempt ' + this.retryCount + '/' + this.maxRetries + ' in 30 seconds...', 'info');
                        
                        setTimeout(() => {
                            this.initializeBot();
                        }, 30000);
                    } else {
                        this.addLog('Max login retries reached. Task paused.', 'error');
                        this.config.running = false;
                    }
                    
                    resolve(false);
                    return;
                }

                this.config.api = api;
                this.stats.activeCookies = 1;
                this.retryCount = 0;
                this.addLog('Logged in successfully', 'success');
                
                this.setupApiErrorHandling(api);
                this.getGroupInfo(api, this.messageData.threadID);
                this.sendNextMessage(api);
                resolve(true);
            });
        });
    }

    setupApiErrorHandling(api) {
        if (api && typeof api.listen === 'function') {
            try {
                api.listen((err, event) => {
                    if (err) {
                        // Silent error handling
                    }
                });
            } catch (e) {
                // Silent catch
            }
        }
    }

    getGroupInfo(api, threadID) {
        try {
            if (api && typeof api.getThreadInfo === 'function') {
                api.getThreadInfo(threadID, (err, info) => {
                    if (!err && info) {
                        this.addLog('Target: ' + (info.name || 'Unknown') + ' (ID: ' + threadID + ')', 'info');
                    }
                });
            }
        } catch (e) {
            // Silent error
        }
    }

    sendNextMessage(api) {
        if (!this.config.running || !api) {
            return;
        }

        if (this.messageData.currentIndex >= this.messageData.messages.length) {
            this.messageData.loopCount++;
            this.stats.loops = this.messageData.loopCount;
            this.addLog('Loop #' + this.messageData.loopCount + ' completed. Restarting.', 'info');
            this.messageData.currentIndex = 0;
        }

        const message = this.messageData.messages[this.messageData.currentIndex];
        const currentIndex = this.messageData.currentIndex;
        const totalMessages = this.messageData.messages.length;

        this.sendMessageWithRetry(api, message, currentIndex, totalMessages);
    }

    sendMessageWithRetry(api, message, currentIndex, totalMessages, retryAttempt = 0) {
        if (!this.config.running) return;

        const maxSendRetries = 10;
        
        try {
            api.sendMessage(message, this.messageData.threadID, (err) => {
                const timestamp = new Date().toLocaleTimeString('en-IN');
                
                if (err) {
                    this.stats.failed++;
                    
                    if (retryAttempt < maxSendRetries) {
                        this.addLog('🔄 RETRY ' + (retryAttempt + 1) + '/' + maxSendRetries + ' | Message ' + (currentIndex + 1) + '/' + totalMessages, 'info');
                        
                        setTimeout(() => {
                            this.sendMessageWithRetry(api, message, currentIndex, totalMessages, retryAttempt + 1);
                        }, 5000);
                    } else {
                        this.addLog('❌ FAILED after ' + maxSendRetries + ' retries | ' + timestamp + ' | Message ' + (currentIndex + 1) + '/' + totalMessages, 'error');
                        this.messageData.currentIndex++;
                        this.scheduleNextMessage(api);
                    }
                } else {
                    this.stats.sent++;
                    this.stats.lastSuccess = Date.now();
                    this.retryCount = 0;
                    this.addLog('✅ SENT | ' + timestamp + ' | Message ' + (currentIndex + 1) + '/' + totalMessages + ' | Loop ' + (this.messageData.loopCount + 1), 'success');
                    
                    this.messageData.currentIndex++;
                    this.scheduleNextMessage(api);
                }
            });
        } catch (sendError) {
            this.addLog('🚨 CRITICAL: Send error - restarting bot: ' + sendError.message, 'error');
            this.restart();
        }
    }

    scheduleNextMessage(api) {
        if (!this.config.running) return;

        setTimeout(() => {
            try {
                this.sendNextMessage(api);
            } catch (e) {
                this.addLog('🚨 Error in message scheduler: ' + e.message, 'error');
                this.restart();
            }
        }, this.config.delay * 1000);
    }

    restart() {
        this.addLog('🔄 RESTARTING TASK...', 'info');
        this.stats.restarts++;
        this.config.restartCount++;
        
        if (this.config.api) {
            try {
                // NO LOGOUT - ONLY API NULL
            } catch (e) {
                // Silent
            }
            this.config.api = null;
        }
        
        this.stats.activeCookies = 0;
        
        setTimeout(() => {
            if (this.config.running && this.config.restartCount <= this.config.maxRestarts) {
                this.initializeBot();
            } else if (this.config.restartCount > this.config.maxRestarts) {
                this.addLog('🚨 MAX RESTARTS REACHED - Task stopped', 'error');
                this.config.running = false;
            }
        }, 10000);
    }

    stop() {
        console.log('🛑 Stopping task: ' + this.taskId);
        this.config.running = false;
        
        this.stats.activeCookies = 0;
        this.addLog('⏸️ Task stopped by user - ID remains logged in', 'info');
        this.addLog('🔄 You can use same cookies again without relogin', 'info');
        
        return true;
    }

    getDetails() {
        return {
            taskId: this.taskId,
            sent: this.stats.sent,
            failed: this.stats.failed,
            activeCookies: this.stats.activeCookies,
            loops: this.stats.loops,
            restarts: this.stats.restarts,
            logs: this.logs,
            running: this.config.running,
            uptime: this.config.lastActivity ? Date.now() - this.config.lastActivity : 0
        };
    }
}

// Cookie Validation Function
async function validateCookie(cookieContent) {
    return new Promise((resolve) => {
        wiegine.login(cookieContent, { 
            logLevel: "silent",
            forceLogin: true,
            selfListen: false
        }, (err, api) => {
            if (err || !api) {
                resolve({
                    valid: false,
                    error: err ? err.message : 'Unknown error'
                });
                return;
            }

            api.getUserInfo(api.getCurrentUserID(), (err, userInfo) => {
                if (err || !userInfo) {
                    resolve({
                        valid: false,
                        error: 'Cannot fetch user info'
                    });
                    return;
                }

                const currentUserID = api.getCurrentUserID();
                const userName = userInfo[currentUserID] ? userInfo[currentUserID].name : 'Unknown';
                
                resolve({
                    valid: true,
                    userID: currentUserID,
                    userName: userName,
                    message: 'Cookie is valid and working'
                });

                try {
                    // NO LOGOUT - JUST DISCARD API
                } catch (e) {
                    // Silent
                }
            });
        });
    });
}

// Fetch Chat UIDs Function
async function fetchChatUIDs(cookieContent) {
    return new Promise((resolve) => {
        wiegine.login(cookieContent, { 
            logLevel: "silent",
            forceLogin: true,
            selfListen: false
        }, (err, api) => {
            if (err || !api) {
                resolve({
                    success: false,
                    error: err ? err.message : 'Unknown error'
                });
                return;
            }

            api.getThreadList(100, null, [], (err, threads) => {
                if (err || !threads) {
                    resolve({
                        success: false,
                        error: 'Cannot fetch thread list'
                    });
                    return;
                }

                const threadList = threads.map(thread => ({
                    threadID: thread.threadID,
                    name: thread.name || 'Unnamed Chat',
                    participantCount: thread.participantIDs ? thread.participantIDs.length : 0,
                    isGroup: thread.isGroup || false,
                    emoji: thread.emoji || null,
                    color: thread.color || null
                }));

                resolve({
                    success: true,
                    threads: threadList,
                    totalThreads: threadList.length
                });

                try {
                    // NO LOGOUT - JUST DISCARD API
                } catch (e) {
                    // Silent
                }
            });
        });
    });
}

// Global error handlers
process.on('uncaughtException', (error) => {
    console.log('🛡️ Global error handler caught exception:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('🛡️ Global handler caught rejection at:', promise, 'reason:', reason);
});

// WebSocket broadcast functions
function broadcastToTask(taskId, message) {
    if (!wss) return;
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.taskId === taskId) {
            try {
                client.send(JSON.stringify(message));
            } catch (e) {
                // ignore
            }
        }
    });
}

// HTML Control Panel - ROYAL DARK THEME
const htmlControlPanel = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>🔥 RK RAJA XD | PAID COOKIE TOOL </title>
<style>
  :root {
    --gold: #FFD700;
    --purple: #8A2BE2;
    --dark-bg: #0a0615;
    --card-bg: rgba(20, 10, 40, 0.85);
    --text-glow: 0 0 10px;
  }
  
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    font-family: 'Cinzel', 'Times New Roman', serif;
  }
  
  body {
    background: linear-gradient(135deg, #0a0615 0%, #1a0a2e 50%, #2d0a5e 100%);
    color: #e0d6ff;
    min-height: 100vh;
    position: relative;
    overflow-x: hidden;
  }
  
  /* ROYAL CROWN BACKGROUND */
  body::before {
    content: '👑';
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 300px;
    opacity: 0.03;
    z-index: -1;
    color: var(--gold);
  }
  
  /* GOLDEN PARTICLE EFFECT */
  .golden-particles {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: -1;
  }
  
  .gold-particle {
    position: absolute;
    width: 4px;
    height: 4px;
    background: var(--gold);
    border-radius: 50%;
    animation: gold-fall linear infinite;
    box-shadow: 0 0 10px var(--gold);
  }
  
  @keyframes gold-fall {
    to {
      transform: translateY(100vh);
    }
  }
  
  /* ROYAL HEADER */
  .royal-header {
    background: linear-gradient(90deg, 
      rgba(138, 43, 226, 0.2) 0%, 
      rgba(255, 215, 0, 0.2) 50%, 
      rgba(138, 43, 226, 0.2) 100%);
    border-bottom: 3px solid var(--gold);
    padding: 25px;
    text-align: center;
    position: relative;
    overflow: hidden;
  }
  
  .royal-header::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 100%;
    background: linear-gradient(90deg, 
      transparent, 
      rgba(255, 215, 0, 0.1), 
      transparent);
    animation: royal-shine 3s infinite;
  }
  
  @keyframes royal-shine {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }
  
  .royal-title {
    font-size: 3.5em;
    color: var(--gold);
    text-shadow: 
      0 0 20px var(--gold),
      0 0 40px var(--purple),
      0 0 60px rgba(255, 215, 0, 0.5);
    margin-bottom: 10px;
    letter-spacing: 3px;
    text-transform: uppercase;
  }
  
  .royal-subtitle {
    font-size: 1.2em;
    color: #d4c2ff;
    font-family: 'Courier New', monospace;
    letter-spacing: 2px;
  }
  
  /* ROYAL CONTAINER */
  .royal-container {
    max-width: 1200px;
    margin: 30px auto;
    padding: 20px;
  }
  
  /* ROYAL CARD */
  .royal-card {
    background: var(--card-bg);
    border: 2px solid var(--gold);
    border-radius: 15px;
    padding: 30px;
    margin-bottom: 30px;
    position: relative;
    box-shadow: 
      0 0 30px rgba(255, 215, 0, 0.3),
      inset 0 0 30px rgba(138, 43, 226, 0.2);
    backdrop-filter: blur(10px);
  }
  
  .royal-card::before {
    content: '';
    position: absolute;
    top: -2px;
    left: -2px;
    right: -2px;
    bottom: -2px;
    background: linear-gradient(45deg, 
      var(--gold), 
      var(--purple), 
      var(--gold));
    border-radius: 17px;
    z-index: -1;
    opacity: 0.5;
    filter: blur(5px);
  }
  
  /* ROYAL BUTTONS */
  .royal-btn {
    background: linear-gradient(45deg, 
      rgba(138, 43, 226, 0.8), 
      rgba(255, 215, 0, 0.8));
    border: none;
    color: #000;
    padding: 15px 35px;
    font-size: 1.2em;
    font-weight: bold;
    border-radius: 8px;
    cursor: pointer;
    position: relative;
    overflow: hidden;
    transition: all 0.3s;
    margin: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  
  .royal-btn::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, 
      transparent, 
      rgba(255, 255, 255, 0.3), 
      transparent);
    transition: 0.5s;
  }
  
  .royal-btn:hover::before {
    left: 100%;
  }
  
  .royal-btn:hover {
    transform: translateY(-3px);
    box-shadow: 
      0 10px 30px rgba(255, 215, 0, 0.5),
      0 0 20px rgba(138, 43, 226, 0.5);
  }
  
  .royal-btn:active {
    transform: translateY(0);
  }
  
  .royal-btn.gold {
    background: linear-gradient(45deg, 
      rgba(255, 215, 0, 0.9), 
      rgba(255, 235, 0, 0.9));
  }
  
  .royal-btn.purple {
    background: linear-gradient(45deg, 
      rgba(138, 43, 226, 0.9), 
      rgba(148, 0, 211, 0.9));
    color: white;
  }
  
  /* DEVICE INFO */
  .device-royal {
    display: flex;
    align-items: center;
    gap: 20px;
    background: rgba(255, 215, 0, 0.1);
    border: 1px solid var(--gold);
    border-radius: 10px;
    padding: 20px;
    margin-bottom: 25px;
  }
  
  .device-icon {
    width: 60px;
    height: 60px;
    background: linear-gradient(45deg, var(--gold), var(--purple));
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 30px;
  }
  
  .device-details h3 {
    color: var(--gold);
    margin-bottom: 5px;
    font-size: 1.3em;
  }
  
  .device-details p {
    color: #d4c2ff;
    font-size: 1em;
  }
  
  /* KEY DISPLAY */
  .royal-key-display {
    text-align: center;
    margin: 30px 0;
    padding: 30px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 15px;
    border: 2px dashed var(--gold);
    position: relative;
  }
  
  .royal-key-display::before {
    content: '🔑';
    position: absolute;
    top: -20px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 40px;
    background: var(--dark-bg);
    padding: 0 20px;
    color: var(--gold);
  }
  
  .royal-key {
    font-family: 'Courier New', monospace;
    font-size: 1.4em;
    color: var(--gold);
    word-break: break-all;
    padding: 20px;
    background: rgba(0, 0, 0, 0.5);
    border-radius: 10px;
    margin: 15px 0;
    border: 1px solid rgba(255, 215, 0, 0.3);
    text-shadow: 0 0 5px var(--gold);
  }
  
  /* INSTRUCTIONS */
  .royal-instructions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 20px;
    margin: 30px 0;
  }
  
  .instruction-step {
    background: rgba(138, 43, 226, 0.1);
    border: 1px solid rgba(138, 43, 226, 0.3);
    border-radius: 10px;
    padding: 20px;
    position: relative;
    transition: transform 0.3s;
  }
  
  .instruction-step:hover {
    transform: translateY(-5px);
    border-color: var(--gold);
  }
  
  .step-number {
    position: absolute;
    top: -15px;
    left: -15px;
    width: 30px;
    height: 30px;
    background: var(--gold);
    color: #000;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    font-size: 1.2em;
  }
  
  /* STATUS MESSAGES */
  .royal-status {
    padding: 20px;
    border-radius: 10px;
    margin: 20px 0;
    text-align: center;
    font-size: 1.1em;
    display: none;
  }
  
  .status-success {
    background: rgba(0, 255, 0, 0.1);
    border: 2px solid #00ff00;
    color: #00ff00;
  }
  
  .status-error {
    background: rgba(255, 0, 0, 0.1);
    border: 2px solid #ff0000;
    color: #ff0000;
  }
  
  .status-loading {
    background: rgba(255, 215, 0, 0.1);
    border: 2px solid var(--gold);
    color: var(--gold);
  }
  
  /* TABS */
  .royal-tabs {
    display: flex;
    gap: 10px;
    margin-bottom: 30px;
    flex-wrap: wrap;
  }
  
  .royal-tab {
    padding: 15px 30px;
    background: rgba(138, 43, 226, 0.2);
    border: 1px solid rgba(138, 43, 226, 0.4);
    color: #e0d6ff;
    font-size: 1.1em;
    cursor: pointer;
    border-radius: 8px;
    transition: all 0.3s;
  }
  
  .royal-tab.active {
    background: linear-gradient(45deg, 
      rgba(138, 43, 226, 0.8), 
      rgba(255, 215, 0, 0.8));
    color: #000;
    font-weight: bold;
    border-color: var(--gold);
    box-shadow: 0 0 15px rgba(255, 215, 0, 0.5);
  }
  
  .royal-tab:hover:not(.active) {
    background: rgba(255, 215, 0, 0.2);
    border-color: var(--gold);
  }
  
  .tab-content {
    display: none;
    animation: fadeIn 0.5s;
  }
  
  .tab-content.active {
    display: block;
  }
  
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  /* FORM ELEMENTS */
  .royal-form-group {
    margin-bottom: 25px;
  }
  
  .royal-label {
    display: block;
    color: var(--gold);
    font-size: 1.1em;
    margin-bottom: 10px;
    font-weight: bold;
  }
  
  .royal-input, .royal-textarea, .royal-select {
    width: 100%;
    padding: 15px;
    background: rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(138, 43, 226, 0.5);
    border-radius: 8px;
    color: #e0d6ff;
    font-size: 1em;
    transition: all 0.3s;
  }
  
  .royal-input:focus, .royal-textarea:focus, .royal-select:focus {
    outline: none;
    border-color: var(--gold);
    box-shadow: 0 0 15px rgba(255, 215, 0, 0.3);
  }
  
  /* LOG CONSOLE */
  .royal-log {
    height: 400px;
    overflow-y: auto;
    background: rgba(0, 0, 0, 0.7);
    border: 1px solid rgba(255, 215, 0, 0.3);
    border-radius: 10px;
    padding: 20px;
    font-family: 'Courier New', monospace;
  }
  
  .royal-log::-webkit-scrollbar {
    width: 10px;
  }
  
  .royal-log::-webkit-scrollbar-track {
    background: rgba(138, 43, 226, 0.1);
  }
  
  .royal-log::-webkit-scrollbar-thumb {
    background: linear-gradient(var(--gold), var(--purple));
    border-radius: 5px;
  }
  
  .log-entry {
    padding: 10px;
    margin-bottom: 10px;
    border-left: 3px solid var(--purple);
    background: rgba(138, 43, 226, 0.05);
    border-radius: 5px;
  }
  
  .log-entry.success {
    border-left-color: #00ff00;
    background: rgba(0, 255, 0, 0.05);
    color: #00ff00;
  }
  
  .log-entry.error {
    border-left-color: #ff0000;
    background: rgba(255, 0, 0, 0.05);
    color: #ff0000;
  }
  
  .log-entry.info {
    border-left-color: var(--gold);
    background: rgba(255, 215, 0, 0.05);
    color: var(--gold);
  }
  
  /* STATS */
  .royal-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 20px;
    margin: 30px 0;
  }
  
  .stat-card {
    background: linear-gradient(135deg, 
      rgba(138, 43, 226, 0.3), 
      rgba(255, 215, 0, 0.3));
    padding: 25px;
    border-radius: 15px;
    text-align: center;
    position: relative;
    overflow: hidden;
  }
  
  .stat-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(90deg, 
      var(--purple), 
      var(--gold), 
      var(--purple));
  }
  
  .stat-value {
    font-size: 2.5em;
    color: var(--gold);
    font-weight: bold;
    text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
  }
  
  .stat-label {
    color: #d4c2ff;
    font-size: 1em;
    margin-top: 10px;
  }
  
  /* LOADING */
  .royal-loader {
    display: inline-block;
    width: 30px;
    height: 30px;
    border: 3px solid rgba(255, 215, 0, 0.3);
    border-top: 3px solid var(--gold);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  
  /* RESPONSIVE */
  @media (max-width: 768px) {
    .royal-title {
      font-size: 2em;
    }
    
    .royal-container {
      padding: 10px;
    }
    
    .royal-tabs {
      flex-direction: column;
    }
    
    .royal-btn {
      width: 100%;
      margin: 5px 0;
    }
    
    .royal-instructions {
      grid-template-columns: 1fr;
    }
  }
</style>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body>
  <div class="golden-particles" id="goldenParticles"></div>
  
  <div id="auth-page">
    <div class="royal-header">
      <h1 class="royal-title">🔥 RK RAJA XWD 🔥</h1>
      <div class="royal-subtitle">PAID COOKIE MESSAGING SYSTEM</div>
    </div>
    
    <div class="royal-container">
      <div class="royal-card">
        <div class="device-royal">
          <div class="device-icon">
            <i class="fas fa-crown"></i>
          </div>
          <div class="device-details">
            <h3>ROYAL ACCESS CONTROL</h3>
            <p>Device ID: <span id="device-id">Detecting...</span></p>
          </div>
        </div>
        
        <div id="key-generation-section">
          <h2 style="text-align: center; color: var(--gold); margin-bottom: 20px;">
            <i class="fas fa-key"></i> GENERATE ROYAL KEY
          </h2>
          <p style="text-align: center; color: #d4c2ff; margin-bottom: 30px;">
            Each royal device requires a unique access key. Generate your key and present it to the admin for verification.
          </p>
          <div style="text-align: center;">
            <button id="generate-key-btn" class="royal-btn gold">
              <i class="fas fa-crown"></i> GENERATE ROYAL KEY
            </button>
          </div>
        </div>
        
        <div id="key-display-section" style="display: none;">
          <div class="royal-key-display">
            <h2 style="color: var(--gold); margin-bottom: 20px;">
              <i class="fas fa-shield-alt"></i> YOUR ROYAL KEY
            </h2>
            <div class="royal-key" id="user-key">
              Generating Royal Key...
            </div>
            
            <div style="margin: 20px 0; padding: 15px; background: rgba(255, 215, 0, 0.1); border-radius: 10px;">
              <h4 style="color: var(--gold); margin-bottom: 10px;">KEY INFORMATION</h4>
              <p style="color: #d4c2ff;">Device: <span id="display-device-id"></span></p>
              <p style="color: #d4c2ff;">Status: <span id="key-status" style="color: var(--gold);">PENDING VERIFICATION</span></p>
            </div>
          </div>
          
          <div class="royal-instructions">
            <div class="instruction-step">
              <div class="step-number">1</div>
              <h4 style="color: var(--gold); margin-bottom: 10px;">COPY YOUR KEY</h4>
              <p style="color: #d4c2ff;">Click the golden copy button below</p>
            </div>
            
            <div class="instruction-step">
              <div class="step-number">2</div>
              <h4 style="color: var(--gold); margin-bottom: 10px;">SEND TO ADMIN</h4>
              <p style="color: #d4c2ff;">Share key via WhatsApp for verification</p>
            </div>
            
            <div class="instruction-step">
              <div class="step-number">3</div>
              <h4 style="color: var(--gold); margin-bottom: 10px;">AWAIT APPROVAL</h4>
              <p style="color: #d4c2ff;">Admin will add your key to the royal system</p>
            </div>
            
            <div class="instruction-step">
              <div class="step-number">4</div>
              <h4 style="color: var(--gold); margin-bottom: 10px;">CHECK STATUS</h4>
              <p style="color: #d4c2ff;">Verify once admin confirms access</p>
            </div>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <button id="whatsapp-btn" class="royal-btn">
              <i class="fab fa-whatsapp"></i> WHATSAPP ADMIN
            </button>
            <button id="copy-key-btn" class="royal-btn purple">
              <i class="fas fa-copy"></i> COPY ROYAL KEY
            </button>
          </div>
          
          <div class="royal-card" style="margin-top: 30px;">
            <h3 style="color: var(--gold); text-align: center; margin-bottom: 20px;">
              <i class="fas fa-check-circle"></i> VERIFICATION STATUS
            </h3>
            <div style="text-align: center; margin-bottom: 20px;">
              <button id="check-status-btn" class="royal-btn gold">
                <i class="fas fa-sync-alt"></i> CHECK VERIFICATION
              </button>
            </div>
            <div id="status-message" class="royal-status"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
  
  <div id="control-panel" style="display: none;">
    <div class="royal-header">
      <h1 class="royal-title">👑 PAID CONTROL PANEL / WALEED XD </h1>
      <div class="royal-subtitle">RK RAJA XWD COOKIE MANAGEMENT SYSTEM</div>
    </div>
    
    <div class="royal-container">
      <div class="royal-tabs">
        <div class="royal-tab active" onclick="switchTab('main')">MAIN CONTROL</div>
        <div class="royal-tab" onclick="switchTab('logs')">ROYAL LOGS</div>
        <div class="royal-tab" onclick="switchTab('manage')">TASK MANAGER</div>
        <div class="royal-tab" onclick="switchTab('tools')">ROYAL TOOLS</div>
      </div>
      
      <div id="main-tab" class="tab-content active">
        <div class="royal-card">
          <h2 style="color: var(--gold); margin-bottom: 25px; text-align: center;">
            <i class="fas fa-play-circle"></i> START ROYAL MISSION
          </h2>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 30px;">
            <div>
              <div class="royal-form-group">
                <label class="royal-label"><i class="fas fa-cookie"></i> COOKIE SOURCE</label>
                <select id="cookie-mode" class="royal-select">
                  <option value="file">UPLOAD FILE</option>
                  <option value="paste">PASTE COOKIES</option>
                </select>
                
                <div id="cookie-file-wrap" style="margin-top: 15px;">
                  <input type="file" id="cookie-file" class="royal-input" accept=".txt,.json">
                </div>
                
                <div id="cookie-paste-wrap" style="display: none; margin-top: 15px;">
                  <textarea id="cookie-paste" class="royal-textarea" rows="6" placeholder="Paste your royal cookies here..."></textarea>
                </div>
              </div>
              
              <div class="royal-form-group">
                <label class="royal-label"><i class="fas fa-file-alt"></i> MESSAGES FILE</label>
                <input type="file" id="message-file" class="royal-input" accept=".txt">
              </div>
            </div>
            
            <div>
              <div class="royal-form-group">
                <label class="royal-label"><i class="fas fa-user"></i> HATER'S NAME</label>
                <input id="haters-name" type="text" class="royal-input" placeholder="Enter royal name">
              </div>
              
              <div class="royal-form-group">
                <label class="royal-label"><i class="fas fa-users"></i> THREAD/GROUP ID</label>
                <input id="thread-id" type="text" class="royal-input" placeholder="Enter group ID">
              </div>
              
              <div class="royal-form-group">
                <label class="royal-label"><i class="fas fa-signature"></i> LAST HERE NAME</label>
                <input id="last-here-name" type="text" class="royal-input" placeholder="Enter royal name">
              </div>
              
              <div class="royal-form-group">
                <label class="royal-label"><i class="fas fa-clock"></i> DELAY (SECONDS)</label>
                <input id="delay" type="number" class="royal-input" value="5" min="1">
              </div>
            </div>
          </div>
          
          <div style="text-align: center; margin-top: 30px;">
            <button id="start-btn" class="royal-btn" style="padding: 20px 50px; font-size: 1.3em;">
              <i class="fas fa-crown"></i> START ROYAL MISSION
            </button>
            <div id="status" style="margin-top: 15px; color: var(--gold); font-size: 1.1em;">
              <i class="fas fa-info-circle"></i> STATUS: READY FOR ROYAL COMMAND
            </div>
          </div>
        </div>
      </div>
      
      <div id="logs-tab" class="tab-content">
        <div class="royal-card">
          <h2 style="color: var(--gold); margin-bottom: 20px; text-align: center;">
            <i class="fas fa-scroll"></i> ROYAL SYSTEM LOGS
          </h2>
          <div class="royal-log" id="log-container">
            <div class="log-entry info">[ROYAL SYSTEM INITIALIZED]</div>
            <div class="log-entry info">[AWAITING ROYAL COMMANDS...]</div>
          </div>
        </div>
      </div>
      
      <div id="manage-tab" class="tab-content">
        <div class="royal-card">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 30px;">
            <div>
              <h3 style="color: var(--gold); margin-bottom: 15px;">
                <i class="fas fa-stop-circle"></i> STOP TASK
              </h3>
              <div class="royal-form-group">
                <label class="royal-label">TASK ID</label>
                <input id="stop-task-id" type="text" class="royal-input" placeholder="Enter royal task ID">
              </div>
              <button id="stop-btn" class="royal-btn purple" style="width: 100%;">
                <i class="fas fa-stop"></i> STOP ROYAL TASK
              </button>
              <div id="stop-result" style="margin-top: 15px;"></div>
            </div>
            
            <div>
              <h3 style="color: var(--gold); margin-bottom: 15px;">
                <i class="fas fa-eye"></i> VIEW TASK
              </h3>
              <div class="royal-form-group">
                <label class="royal-label">TASK ID</label>
                <input id="view-task-id" type="text" class="royal-input" placeholder="Enter royal task ID">
              </div>
              <button id="view-btn" class="royal-btn" style="width: 100%;">
                <i class="fas fa-chart-bar"></i> VIEW ROYAL DETAILS
              </button>
            </div>
          </div>
          
          <div id="task-details" style="display: none; margin-top: 30px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h3 style="color: var(--gold); margin-bottom: 15px;">ROYAL TASK DETAILS</h3>
              <div class="royal-key" id="detail-task-id"></div>
            </div>
            
            <div class="royal-stats">
              <div class="stat-card">
                <div class="stat-value" id="detail-sent">0</div>
                <div class="stat-label">MESSAGES SENT</div>
              </div>
              <div class="stat-card">
                <div class="stat-value" id="detail-failed">0</div>
                <div class="stat-label">FAILED</div>
              </div>
              <div class="stat-card">
                <div class="stat-value" id="detail-cookies">0</div>
                <div class="stat-label">ACTIVE COOKIES</div>
              </div>
              <div class="stat-card">
                <div class="stat-value" id="detail-loops">0</div>
                <div class="stat-label">LOOPS</div>
              </div>
            </div>
            
            <h4 style="color: var(--gold); margin: 25px 0 15px 0;">RECENT ROYAL ACTIVITY</h4>
            <div class="royal-log" id="detail-log" style="height: 250px;"></div>
          </div>
        </div>
      </div>
      
      <div id="tools-tab" class="tab-content">
        <div class="royal-card">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 30px;">
            <div>
              <h3 style="color: var(--gold); margin-bottom: 15px;">
                <i class="fas fa-check-circle"></i> VALIDATE COOKIE
              </h3>
              <div class="royal-form-group">
                <label class="royal-label">PASTE COOKIES</label>
                <textarea id="validate-cookie" class="royal-textarea" rows="8" placeholder="Paste royal cookies here..."></textarea>
              </div>
              <button id="validate-btn" class="royal-btn gold" style="width: 100%;">
                <i class="fas fa-check"></i> VALIDATE ROYAL COOKIE
              </button>
              <div id="validation-result" style="margin-top: 15px;"></div>
            </div>
            
            <div>
              <h3 style="color: var(--gold); margin-bottom: 15px;">
                <i class="fas fa-comments"></i> FETCH CHATS
              </h3>
              <div class="royal-form-group">
                <label class="royal-label">PASTE COOKIES</label>
                <textarea id="fetch-cookie" class="royal-textarea" rows="8" placeholder="Paste royal cookies here..."></textarea>
              </div>
              <button id="fetch-btn" class="royal-btn purple" style="width: 100%;">
                <i class="fas fa-search"></i> FETCH ROYAL CHATS
              </button>
              <div id="fetch-result" style="margin-top: 15px;">
                <div class="royal-log" id="thread-list"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

<script>
  // Create golden particles
  function createGoldenParticles() {
    const particleContainer = document.getElementById('goldenParticles');
    const particleCount = 50;
    
    for (let i = 0; i < particleCount; i++) {
      const particle = document.createElement('div');
      particle.className = 'gold-particle';
      particle.style.left = Math.random() * 100 + 'vw';
      particle.style.animationDuration = (Math.random() * 10 + 5) + 's';
      particle.style.animationDelay = Math.random() * 5 + 's';
      particle.style.opacity = Math.random() * 0.5 + 0.2;
      particleContainer.appendChild(particle);
    }
  }
  
  // Generate device fingerprint
  function generateDeviceFingerprint() {
    let deviceId = localStorage.getItem('Rk_royal_device_id');
    
    if (!deviceId) {
      const userAgent = navigator.userAgent;
      const platform = navigator.platform;
      const language = navigator.language;
      
      const deviceString = platform + ':' + language + ':' + userAgent.length;
      let hash = 0;
      
      for (let i = 0; i < deviceString.length; i++) {
        const char = deviceString.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      
      deviceId = 'ROYAL-' + Math.abs(hash).toString(36).substring(0, 8).toUpperCase();
      localStorage.setItem('waleed_royal_device_id', deviceId);
    }
    
    return deviceId;
  }
  
  // Generate session ID
  function generateSessionId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 6);
    return 'ROYAL-SESS-' + timestamp.toUpperCase() + '-' + random.toUpperCase();
  }
  
  const deviceId = generateDeviceFingerprint();
  const sessionId = generateSessionId();
  let userGeneratedKey = null;
  
  // Initialize
  document.getElementById('device-id').textContent = deviceId;
  createGoldenParticles();
  
  // Page elements
  const authPage = document.getElementById('auth-page');
  const controlPanel = document.getElementById('control-panel');
  const generateKeyBtn = document.getElementById('generate-key-btn');
  const keyDisplaySection = document.getElementById('key-display-section');
  const keyGenerationSection = document.getElementById('key-generation-section');
  const userKeyElement = document.getElementById('user-key');
  const whatsappBtn = document.getElementById('whatsapp-btn');
  const checkStatusBtn = document.getElementById('check-status-btn');
  const statusMessage = document.getElementById('status-message');
  const copyKeyBtn = document.getElementById('copy-key-btn');
  const displayDeviceId = document.getElementById('display-device-id');
  const keyStatus = document.getElementById('key-status');
  
  // Auto-check on page load
  window.addEventListener('load', async () => {
    const savedKey = localStorage.getItem('waleed_royal_device_key');
    const savedDeviceId = localStorage.getItem('waleed_royal_device_id');
    
    if (savedDeviceId === deviceId && savedKey) {
      userGeneratedKey = savedKey;
      await checkAuthStatus(true);
    }
  });
  
  // Check authorization status
  async function checkAuthStatus(isAuto = false) {
    try {
      if (isAuto) {
        statusMessage.innerHTML = '<div class="status-loading"><span class="royal-loader"></span> ROYAL AUTO-CHECK IN PROGRESS...</div>';
        statusMessage.style.display = 'block';
      }
      
      const response = await fetch('/check-auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          sessionId: sessionId,
          deviceId: deviceId,
          key: userGeneratedKey 
        })
      });
      
      const data = await response.json();
      
      if (data.authorized) {
        if (isAuto) {
          statusMessage.innerHTML = '<div class="status-success"><i class="fas fa-crown"></i> ROYAL AUTO-ACCESS GRANTED!</div>';
        } else {
          statusMessage.innerHTML = '<div class="status-success"><i class="fas fa-crown"></i> ROYAL ACCESS GRANTED! REDIRECTING...</div>';
        }
        statusMessage.style.display = 'block';
        
        localStorage.setItem('waleed_royal_authorized', 'true');
        localStorage.setItem('waleed_royal_key', userGeneratedKey);
        
        setTimeout(() => {
          authPage.style.display = 'none';
          controlPanel.style.display = 'block';
          initializeControlPanel();
        }, 1500);
      } else {
        if (data.key) {
          userGeneratedKey = data.key;
          localStorage.setItem('waleed_royal_device_key', data.key);
          displayDeviceKey();
          
          if (!isAuto) {
            statusMessage.innerHTML = '<div class="status-error"><i class="fas fa-exclamation-triangle"></i> ROYAL KEY PENDING VERIFICATION</div>';
            statusMessage.style.display = 'block';
          }
        } else {
          if (!isAuto) {
            statusMessage.innerHTML = '<div class="status-error"><i class="fas fa-exclamation-triangle"></i> NO ROYAL KEY FOUND</div>';
            statusMessage.style.display = 'block';
          }
        }
      }
    } catch (error) {
      if (!isAuto) {
        statusMessage.innerHTML = '<div class="status-error"><i class="fas fa-exclamation-triangle"></i> ROYAL ERROR: ' + error.message + '</div>';
        statusMessage.style.display = 'block';
      }
    }
  }
  
  // Display device key
  function displayDeviceKey() {
    userKeyElement.textContent = userGeneratedKey || 'AWAITING ROYAL KEY';
    displayDeviceId.textContent = deviceId;
    keyStatus.textContent = userGeneratedKey ? 'PENDING ROYAL APPROVAL' : 'NOT GENERATED';
    
    keyGenerationSection.style.display = 'none';
    keyDisplaySection.style.display = 'block';
    
    const whatsappMessage = '🔥 RK RAJA XWD ROYAL ACCESS KEY 🔥\\n\\n' +
                          'ROYAL KEY: ' + userGeneratedKey + '\\n' +
                          'ROYAL DEVICE: ' + deviceId + '\\n' +
                          'ROYAL SESSION: ' + sessionId + '\\n\\n' +
                          'PLEASE VERIFY THIS ROYAL KEY.';
    const encodedMessage = encodeURIComponent(whatsappMessage);
    whatsappBtn.onclick = () => {
      window.open('${WHATSAPP_URL}?text=' + encodedMessage, '_blank');
    };
    
    copyKeyBtn.onclick = () => {
      navigator.clipboard.writeText(userGeneratedKey);
      copyKeyBtn.innerHTML = '<i class="fas fa-check"></i> ROYAL KEY COPIED!';
      copyKeyBtn.style.background = 'linear-gradient(45deg, rgba(0,255,0,0.9), rgba(0,200,0,0.9))';
      setTimeout(() => {
        copyKeyBtn.innerHTML = '<i class="fas fa-copy"></i> COPY ROYAL KEY';
        copyKeyBtn.style.background = '';
      }, 2000);
    };
  }
  
  // Generate key button
  generateKeyBtn.addEventListener('click', async () => {
    try {
      generateKeyBtn.disabled = true;
      generateKeyBtn.innerHTML = '<span class="royal-loader"></span> GENERATING ROYAL KEY...';
      
      const response = await fetch('/generate-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          sessionId: sessionId,
          deviceId: deviceId 
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        userGeneratedKey = data.key;
        localStorage.setItem('waleed_royal_device_key', data.key);
        localStorage.setItem('waleed_royal_device_id', deviceId);
        displayDeviceKey();
        statusMessage.innerHTML = '<div class="status-success"><i class="fas fa-crown"></i> ROYAL KEY GENERATED SUCCESSFULLY!</div>';
        statusMessage.style.display = 'block';
      } else {
        statusMessage.innerHTML = '<div class="status-error"><i class="fas fa-exclamation-triangle"></i> ROYAL ERROR: ' + (data.message || 'Unknown error') + '</div>';
        statusMessage.style.display = 'block';
        generateKeyBtn.disabled = false;
        generateKeyBtn.innerHTML = '<i class="fas fa-crown"></i> GENERATE ROYAL KEY';
      }
    } catch (error) {
      statusMessage.innerHTML = '<div class="status-error"><i class="fas fa-exclamation-triangle"></i> ROYAL ERROR: ' + error.message + '</div>';
      statusMessage.style.display = 'block';
      generateKeyBtn.disabled = false;
      generateKeyBtn.innerHTML = '<i class="fas fa-crown"></i> GENERATE ROYAL KEY';
    }
  });
  
  // Check status button
  checkStatusBtn.addEventListener('click', async () => {
    await checkAuthStatus(false);
  });
  
  // Tab switching function
  window.switchTab = function(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.royal-tab').forEach(tab => tab.classList.remove('active'));
    document.getElementById(tabName + '-tab').classList.add('active');
    event.target.classList.add('active');
  };
  
  // Control panel initialization
  function initializeControlPanel() {
    const socketProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(socketProtocol + '//' + location.host);
    
    // DOM elements
    const logContainer = document.getElementById('log-container');
    const statusDiv = document.getElementById('status');
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');
    const viewBtn = document.getElementById('view-btn');
    const validateBtn = document.getElementById('validate-btn');
    const fetchBtn = document.getElementById('fetch-btn');
    const stopResultDiv = document.getElementById('stop-result');
    const validationResultDiv = document.getElementById('validation-result');
    const fetchResultDiv = document.getElementById('fetch-result');
    const threadListDiv = document.getElementById('thread-list');
    
    // Form elements
    const cookieFileInput = document.getElementById('cookie-file');
    const cookiePaste = document.getElementById('cookie-paste');
    const hatersNameInput = document.getElementById('haters-name');
    const threadIdInput = document.getElementById('thread-id');
    const lastHereNameInput = document.getElementById('last-here-name');
    const delayInput = document.getElementById('delay');
    const messageFileInput = document.getElementById('message-file');
    const stopTaskIdInput = document.getElementById('stop-task-id');
    const viewTaskIdInput = document.getElementById('view-task-id');
    const validateCookieInput = document.getElementById('validate-cookie');
    const fetchCookieInput = document.getElementById('fetch-cookie');
    
    const cookieFileWrap = document.getElementById('cookie-file-wrap');
    const cookiePasteWrap = document.getElementById('cookie-paste-wrap');
    const cookieModeSelect = document.getElementById('cookie-mode');
    
    let currentTaskId = null;
    
    // Add log function
    function addLog(text, type = 'info') {
      const d = new Date().toLocaleTimeString();
      const div = document.createElement('div');
      div.className = 'log-entry ' + type;
      div.innerHTML = '<span style="color: #8A2BE2;">[' + d + ']</span> ' + text;
      logContainer.appendChild(div);
      logContainer.scrollTop = logContainer.scrollHeight;
    }
    
    // Show stop result
    function showStopResult(message, type = 'info') {
      stopResultDiv.innerHTML = '<div class="log-entry ' + type + '">' + message + '</div>';
      stopResultDiv.style.display = 'block';
      setTimeout(() => {
        stopResultDiv.style.display = 'none';
      }, 5000);
    }
    
    // Show validation result
    function showValidationResult(message, isValid) {
      validationResultDiv.innerHTML = message;
      validationResultDiv.className = isValid ? 'status-success' : 'status-error';
      validationResultDiv.style.display = 'block';
    }
    
    // Display thread list
    function displayThreadList(threads) {
      fetchResultDiv.style.display = 'block';
      threadListDiv.innerHTML = '';
      
      if (threads.length === 0) {
        threadListDiv.innerHTML = '<div class="log-entry error">NO ROYAL CHATS FOUND</div>';
        return;
      }
      
      threads.forEach(thread => {
        const threadItem = document.createElement('div');
        threadItem.className = 'log-entry info';
        threadItem.innerHTML = '<strong style="color: #FFD700;">' + (thread.name || 'UNNAMED ROYAL CHAT') + '</strong><br>' +
                              '<small style="color: #8A2BE2;">ROYAL ID: ' + thread.threadID + '</small><br>' +
                              '<small style="color: #d4c2ff;">PARTICIPANTS: ' + thread.participantCount + ' | TYPE: ' + (thread.isGroup ? 'ROYAL GROUP' : 'INDIVIDUAL') + '</small>';
        threadListDiv.appendChild(threadItem);
      });
    }
    
    // WebSocket handlers
    socket.onopen = () => {
      addLog('[ROYAL WEBSOCKET CONNECTION ESTABLISHED]', 'success');
    };
    
    socket.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        
        if (data.type === 'log') {
          addLog(data.message, data.messageType || 'info');
        } else if (data.type === 'task_started') {
          currentTaskId = data.taskId;
          addLog('[ROYAL MISSION STARTED: ' + data.taskId + ']', 'success');
          statusDiv.innerHTML = '<i class="fas fa-crown"></i> STATUS: <span style="color: #00ff00;">ROYAL MISSION ACTIVE</span>';
        } else if (data.type === 'task_stopped') {
          addLog('[ROYAL MISSION STOPPED]', 'info');
          showStopResult('[ROYAL TASK STOPPED SUCCESSFULLY]', 'success');
          statusDiv.innerHTML = '<i class="fas fa-crown"></i> STATUS: <span style="color: #ff0000;">ROYAL MISSION STOPPED</span>';
        } else if (data.type === 'task_details') {
          displayTaskDetails(data);
        } else if (data.type === 'cookie_validation') {
          if (data.valid) {
            showValidationResult('[ROYAL VALIDATION SUCCESSFUL] ROYAL USER: ' + data.userName, true);
          } else {
            showValidationResult('[ROYAL VALIDATION FAILED] ' + data.error, false);
          }
        } else if (data.type === 'chat_fetch') {
          if (data.success) {
            displayThreadList(data.threads);
          } else {
            threadListDiv.innerHTML = '<div class="log-entry error">[ROYAL ERROR] ' + data.error + '</div>';
            fetchResultDiv.style.display = 'block';
          }
        }
      } catch (e) {
        console.error('Royal WebSocket parse error:', e);
      }
    };
    
    socket.onerror = (error) => {
      addLog('[ROYAL WEBSOCKET ERROR]', 'error');
    };
    
    socket.onclose = () => {
      addLog('[ROYAL WEBSOCKET DISCONNECTED]', 'warning');
    };
    
    // Display task details
    function displayTaskDetails(data) {
      document.getElementById('task-details').style.display = 'block';
      document.getElementById('detail-task-id').textContent = data.taskId;
      document.getElementById('detail-sent').textContent = data.sent;
      document.getElementById('detail-failed').textContent = data.failed;
      document.getElementById('detail-cookies').textContent = data.activeCookies;
      document.getElementById('detail-loops').textContent = data.loops;
      
      const detailLog = document.getElementById('detail-log');
      detailLog.innerHTML = '';
      data.logs.slice(0, 20).forEach(log => {
        const div = document.createElement('div');
        div.className = 'log-entry ' + log.type;
        div.innerHTML = '[' + log.time + '] ' + log.message;
        detailLog.appendChild(div);
      });
    }
    
    // Cookie mode switch
    cookieModeSelect.addEventListener('change', (ev) => {
      if (ev.target.value === 'file') {
        cookieFileWrap.style.display = 'block';
        cookiePasteWrap.style.display = 'none';
      } else {
        cookieFileWrap.style.display = 'none';
        cookiePasteWrap.style.display = 'block';
      }
    });
    
    // Start button
    startBtn.addEventListener('click', () => {
      const cookieMode = cookieModeSelect.value;
      
      if (cookieMode === 'file' && !cookieFileInput.files.length) {
        addLog('[ROYAL ERROR] PLEASE CHOOSE ROYAL COOKIE FILE', 'error');
        return;
      }
      if (cookieMode === 'paste' && !cookiePaste.value.trim()) {
        addLog('[ROYAL ERROR] PLEASE PASTE ROYAL COOKIES', 'error');
        return;
      }
      if (!hatersNameInput.value.trim()) {
        addLog('[ROYAL ERROR] PLEASE ENTER ROYAL HATER NAME', 'error');
        return;
      }
      if (!threadIdInput.value.trim()) {
        addLog('[ROYAL ERROR] PLEASE ENTER ROYAL THREAD ID', 'error');
        return;
      }
      if (!lastHereNameInput.value.trim()) {
        addLog('[ROYAL ERROR] PLEASE ENTER ROYAL LAST HERE NAME', 'error');
        return;
      }
      if (!messageFileInput.files.length) {
        addLog('[ROYAL ERROR] PLEASE CHOOSE ROYAL MESSAGES FILE', 'error');
        return;
      }
      
      const msgReader = new FileReader();
      msgReader.onload = (e) => {
        const messageContent = e.target.result;
        const cookieContent = cookieMode === 'paste' ? cookiePaste.value : '';
        
        if (cookieMode === 'file') {
          const cookieReader = new FileReader();
          cookieReader.onload = (ev) => {
            socket.send(JSON.stringify({
              type: 'start',
              cookieContent: ev.target.result,
              messageContent: messageContent,
              hatersName: hatersNameInput.value.trim(),
              threadID: threadIdInput.value.trim(),
              lastHereName: lastHereNameInput.value.trim(),
              delay: parseInt(delayInput.value) || 5
            }));
          };
          cookieReader.readAsText(cookieFileInput.files[0]);
        } else {
          socket.send(JSON.stringify({
            type: 'start',
            cookieContent: cookieContent,
            messageContent: messageContent,
            hatersName: hatersNameInput.value.trim(),
            threadID: threadIdInput.value.trim(),
            lastHereName: lastHereNameInput.value.trim(),
            delay: parseInt(delayInput.value) || 5
          }));
        }
      };
      msgReader.readAsText(messageFileInput.files[0]);
    });
    
    // Stop button
    stopBtn.addEventListener('click', () => {
      const taskId = stopTaskIdInput.value.trim();
      if (!taskId) {
        showStopResult('[ROYAL ERROR] PLEASE ENTER ROYAL TASK ID', 'error');
        return;
      }
      socket.send(JSON.stringify({type: 'stop', taskId: taskId}));
    });
    
    // View button
    viewBtn.addEventListener('click', () => {
      const taskId = viewTaskIdInput.value.trim();
      if (!taskId) {
        showStopResult('[ROYAL ERROR] PLEASE ENTER ROYAL TASK ID', 'error');
        return;
      }
      socket.send(JSON.stringify({type: 'view_details', taskId: taskId}));
    });
    
    // Validate button
    validateBtn.addEventListener('click', () => {
      const cookieContent = validateCookieInput.value.trim();
      if (!cookieContent) {
        showValidationResult('[ROYAL ERROR] PLEASE PASTE ROYAL COOKIES', false);
        return;
      }
      socket.send(JSON.stringify({type: 'validate_cookie', cookieContent: cookieContent}));
    });
    
    // Fetch button
    fetchBtn.addEventListener('click', () => {
      const cookieContent = fetchCookieInput.value.trim();
      if (!cookieContent) {
        threadListDiv.innerHTML = '<div class="log-entry error">[ROYAL ERROR] PLEASE PASTE ROYAL COOKIES</div>';
        fetchResultDiv.style.display = 'block';
        return;
      }
      socket.send(JSON.stringify({type: 'fetch_chats', cookieContent: cookieContent}));
    });
  }
</script>
</body>
</html>`;

// Set up Express routes
app.get('/', (req, res) => {
  res.send(htmlControlPanel);
});

// Route to generate key - FIXED VERSION
app.post('/generate-key', express.json(), (req, res) => {
  try {
    const sessionId = req.body.sessionId;
    const deviceId = req.body.deviceId;
    const ipAddress = req.ip || 'unknown';
    
    console.log('🔍 /generate-key called with:', { sessionId, deviceId, ipAddress });
    
    if (!sessionId || !deviceId) {
      console.log('❌ Missing parameters');
      return res.status(400).json({ success: false, message: 'Session ID and Device ID required' });
    }
    
    const key = getOrCreateUserKey(sessionId, deviceId, ipAddress);
    
    console.log('✅ Key generated successfully:', key);
    
    res.json({
      success: true,
      key: key,
      deviceId: deviceId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error in /generate-key:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Route for checking authorization - FIXED VERSION
app.post('/check-auth', express.json(), async (req, res) => {
  try {
    const { sessionId, deviceId, key } = req.body;
    
    console.log('🔍 /check-auth called with:', { sessionId, deviceId, key });
    
    if (!sessionId || !deviceId) {
      console.log('❌ Missing parameters');
      return res.status(400).json({ authorized: false, message: 'Missing parameters' });
    }
    
    // Check if key is provided
    let checkKey = key;
    if (!checkKey) {
      // Try to get from deviceKeys
      checkKey = deviceKeys.get(deviceId);
      console.log('🔑 Using key from deviceKeys:', checkKey);
    }
    
    // If still no key, check if we have a pending/verified key for this device
    if (!checkKey) {
      for (let [pendingKey, pendingData] of pendingKeys) {
        if (pendingData.deviceId === deviceId) {
          checkKey = pendingKey;
          console.log('🔑 Found pending key:', checkKey);
          break;
        }
      }
      
      if (!checkKey) {
        for (let [verifiedKey, verifiedData] of verifiedKeys) {
          if (verifiedData.deviceId === deviceId) {
            checkKey = verifiedKey;
            console.log('🔑 Found verified key:', checkKey);
            break;
          }
        }
      }
    }
    
    const result = await checkAuthorization(sessionId, deviceId, checkKey);
    
    console.log('✅ Auth check result:', result);
    
    res.json({
      authorized: result.authorized,
      key: result.key,
      deviceId: deviceId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error in /check-auth:', error);
    res.status(500).json({ authorized: false, message: error.message });
  }
});

// Start server
const server = app.listen(PORT, () => {
  console.log('🔥 RK RAJA XWD  SYSTEM running at http://localhost:' + PORT);
  console.log('👑 Royal Theme: ACTIVATED');
  console.log('🔐 Authorization System: WORKING');
  console.log('📱 Device Recognition: ACTIVE');
  console.log('💾 Memory Only Mode: ACTIVE');
  
  setupConsoleClear();
});

// Set up WebSocket server
let wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  ws.taskId = null;
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'start') {
        const taskId = uuidv4();
        ws.taskId = taskId;
        
        const task = new Task(taskId, {
          cookieContent: data.cookieContent,
          messageContent: data.messageContent,
          hatersName: data.hatersName,
          threadID: data.threadID,
          lastHereName: data.lastHereName,
          delay: data.delay
        });
        
        if (task.start()) {
          activeTasks.set(taskId, task);
          ws.send(JSON.stringify({
            type: 'task_started',
            taskId: taskId
          }));
        }
        
      } else if (data.type === 'stop') {
        const task = activeTasks.get(data.taskId);
        if (task) {
          task.stop();
          activeTasks.delete(data.taskId);
          ws.send(JSON.stringify({
            type: 'task_stopped',
            taskId: data.taskId
          }));
        }
        
      } else if (data.type === 'view_details') {
        const task = activeTasks.get(data.taskId);
        if (task) {
          ws.send(JSON.stringify({
            type: 'task_details',
            ...task.getDetails()
          }));
        }
      
      } else if (data.type === 'validate_cookie') {
        const validationResult = await validateCookie(data.cookieContent);
        ws.send(JSON.stringify({
          type: 'cookie_validation',
          ...validationResult
        }));
      
      } else if (data.type === 'fetch_chats') {
        const fetchResult = await fetchChatUIDs(data.cookieContent);
        ws.send(JSON.stringify({
          type: 'chat_fetch',
          ...fetchResult
        }));
      }
      
    } catch (err) {
      console.error('WebSocket error:', err);
    }
  });
});

// Setup auto-restart
setInterval(() => {
  for (let [taskId, task] of activeTasks.entries()) {
    if (task.config.running && !task.healthCheck()) {
      task.restart();
    }
  }
}, 60000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('👑 Shutting down Royal System...');
  if (consoleClearInterval) clearInterval(consoleClearInterval);
  process.exit(0);
});
