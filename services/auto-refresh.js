#!/usr/bin/env node
/**
 * Auto-refresh script for news sources
 * Refreshes all sources every 5 hours
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { atomicWriteJSON } = require('./atomic-write');

const execAsync = promisify(exec);
const ROOT = path.resolve(__dirname, '..');
function loadEnvFile() {
    const envPath = path.join(ROOT, '.env');
    if (!fs.existsSync(envPath)) {
        return;
    }
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            return;
        }
        const cleaned = trimmed.startsWith('export ') ? trimmed.slice(7) : trimmed;
        const [key, ...rest] = cleaned.split('=');
        if (!key || rest.length === 0) {
            return;
        }
        if (process.env[key]) {
            return;
        }
        const value = rest.join('=').trim().replace(/^\"|\"$/g, '').replace(/^'|'$/g, '');
        process.env[key] = value;
    });
}

loadEnvFile();

const rawInterval = parseFloat(process.env.REFRESH_INTERVAL_HOURS);
const intervalHours = Number.isFinite(rawInterval) && rawInterval > 0 ? rawInterval : 5;
const REFRESH_INTERVAL = intervalHours * 60 * 60 * 1000; // hours in milliseconds
const TIME_JSON_PATH = path.join(ROOT, 'etc', 'time.json');
const RSS_SERVER_URL = process.env.RSS_SERVER_URL || 'http://localhost:8001/api/rss/all?force=true';

function readLastUpdate() {
    try {
        const raw = fs.readFileSync(TIME_JSON_PATH, 'utf8');
        const data = JSON.parse(raw);
        return data.lastUpdate ? new Date(data.lastUpdate) : null;
    } catch (error) {
        return null;
    }
}

function shouldRefresh() {
    const lastUpdate = readLastUpdate();
    if (!lastUpdate || Number.isNaN(lastUpdate.getTime())) {
        return true;
    }

    const now = new Date();
    const elapsedMs = now - lastUpdate;
    const isNewDay = now.toISOString().split('T')[0] !== lastUpdate.toISOString().split('T')[0];

    return isNewDay || elapsedMs >= REFRESH_INTERVAL;
}

// Update time.json with current timestamp and maintain history
function updateTimeJson() {
    try {
        // Get current time in Moscow timezone (ISO format with +03:00 offset)
        const nowUtc = new Date();
        const nowMoscow = new Date(nowUtc.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));

        // Format as ISO string with MSK timezone indicator
        const year = nowMoscow.getFullYear();
        const month = String(nowMoscow.getMonth() + 1).padStart(2, '0');
        const day = String(nowMoscow.getDate()).padStart(2, '0');
        const hour = String(nowMoscow.getHours()).padStart(2, '0');
        const minute = String(nowMoscow.getMinutes()).padStart(2, '0');
        const second = String(nowMoscow.getSeconds()).padStart(2, '0');
        const now = `${year}-${month}-${day}T${hour}:${minute}:${second}+03:00`;

        // Read existing data
        let existingData = { history: [] };
        try {
            const raw = fs.readFileSync(TIME_JSON_PATH, 'utf8');
            existingData = JSON.parse(raw);
            if (!existingData.history) {
                existingData.history = [];
            }
        } catch (e) {
            // File doesn't exist or is invalid, start fresh
        }

        // Add new entry to history (keep last 20 entries)
        existingData.history.unshift({
            timestamp: now,
            intervalHours: intervalHours
        });

        // Keep only last 20 entries
        if (existingData.history.length > 20) {
            existingData.history = existingData.history.slice(0, 20);
        }

        // Update main data
        const timeData = {
            lastUpdate: now,
            updateIntervalHours: intervalHours,
            history: existingData.history
        };

        fs.writeFileSync(TIME_JSON_PATH, JSON.stringify(timeData, null, 2), 'utf8');
        console.log(`Updated time.json with Moscow time: ${now} (history: ${timeData.history.length} entries)`);
    } catch (error) {
        console.error('Error updating time.json:', error.message);
    }
}

function requestUrl(url, options = {}) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const method = options.method || 'GET';
        const urlObj = new URL(url);

        const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method: method
        };

        const req = client.request(reqOptions, (res) => {
            const { statusCode } = res;
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                if (statusCode && statusCode >= 200 && statusCode < 300) {
                    resolve(Buffer.concat(chunks).toString('utf8'));
                    return;
                }
                reject(new Error(`HTTP ${statusCode || 'unknown'}`));
            });
        });
        req.on('error', reject);
        req.end();
    });
}

async function refreshAllSources(force = false) {
    if (!force && !shouldRefresh()) {
        console.log(`[${new Date().toISOString()}] Skipping refresh (interval not reached and day unchanged)`);
        return;
    }

    console.log(`[${new Date().toISOString()}] Starting refresh of all sources...`);

    let successCount = 0;
    let errorCount = 0;

    // Refresh RSS cache (updates my-source-jsons via rss-server)
    try {
        console.log('Refreshing RSS cache...');
        await requestUrl(RSS_SERVER_URL);
        successCount++;
    } catch (error) {
        console.warn(`RSS cache refresh skipped: ${error.message}`);
        errorCount++;
    }

    // Refresh Hugging Face
    try {
        console.log('Refreshing Hugging Face...');
        const hfResult = await execAsync('python3 parsers/web-scraper.py huggingface', { cwd: ROOT });
        const hfData = JSON.parse(hfResult.stdout);
        atomicWriteJSON(path.join(ROOT, 'data/news-aggregator-jsons/huggingface.json'), hfData);
        successCount++;
    } catch (error) {
        console.error(`Error refreshing Hugging Face: ${error.message}`);
        errorCount++;
    }

    // Refresh Lobsters
    try {
        console.log('Refreshing Lobsters...');
        const lobstersResult = await execAsync('python3 parsers/web-scraper.py lobsters', { cwd: ROOT });
        const lobstersData = JSON.parse(lobstersResult.stdout);
        atomicWriteJSON(path.join(ROOT, 'data/news-aggregator-jsons/lobsters.json'), lobstersData);
        successCount++;
    } catch (error) {
        console.error(`Error refreshing Lobsters: ${error.message}`);
        errorCount++;
    }

    // Refresh Telegram
    try {
        console.log('Refreshing Telegram...');
        await execAsync('python3 parsers/parsing_telegram.py', { cwd: ROOT });
        successCount++;
    } catch (error) {
        console.error(`Error refreshing Telegram: ${error.message}`);
        errorCount++;
    }

    // Refresh Midjourney (takes longer)
    try {
        console.log('Refreshing Midjourney...');
        await execAsync('node parsers/midjourney-scraper.js', { cwd: ROOT });
        successCount++;
    } catch (error) {
        console.error(`Error refreshing Midjourney: ${error.message}`);
        errorCount++;
    }

    // Update time.json regardless of partial failures
    // This ensures the UI reflects that an update attempt was made
    updateTimeJson();

    // Clear server cache to force fresh data on next request
    try {
        await requestUrl('http://localhost:8000/api/cache/clear', { method: 'POST' });
        console.log('Cache cleared successfully');
    } catch (error) {
        console.warn(`Failed to clear cache: ${error.message}`);
    }

    if (errorCount > 0) {
        console.log(`[${new Date().toISOString()}] ⚠ Refresh completed with ${successCount} successes and ${errorCount} errors`);
    } else {
        console.log(`[${new Date().toISOString()}] ✓ All sources refreshed successfully`);
    }
}

const args = new Set(process.argv.slice(2));
const forceOnce = args.has('--force-once');

if (forceOnce) {
    refreshAllSources(true).then(() => process.exit(0)).catch(() => process.exit(1));
} else {
    // Run on startup
    console.log('Auto-refresh service started');
    console.log(`Refresh interval: ${REFRESH_INTERVAL / 1000 / 60 / 60} hours`);

    // Check if refresh is needed on startup
    const lastUpdate = readLastUpdate();
    if (lastUpdate) {
        const now = new Date();
        const elapsedMs = now - lastUpdate;
        const elapsedHours = (elapsedMs / (1000 * 60 * 60)).toFixed(2);
        console.log(`Last update was ${elapsedHours} hours ago`);

        if (shouldRefresh()) {
            console.log('Refresh needed on startup - running now...');
            refreshAllSources();
        } else {
            console.log('No refresh needed yet - next refresh in', (intervalHours - parseFloat(elapsedHours)).toFixed(2), 'hours');
        }
    } else {
        console.log('No previous update found - running first refresh...');
        refreshAllSources();
    }

    // Schedule periodic refreshes (check every 30 minutes)
    setInterval(() => {
        if (shouldRefresh()) {
            console.log('Interval check: refresh needed, starting...');
            refreshAllSources();
        } else {
            const lastUpdate = readLastUpdate();
            const now = new Date();
            const elapsedHours = ((now - lastUpdate) / (1000 * 60 * 60)).toFixed(2);
            console.log(`Interval check: no refresh needed yet (${elapsedHours}h / ${intervalHours}h)`);
        }
    }, 30 * 60 * 1000); // Check every 30 minutes
}
