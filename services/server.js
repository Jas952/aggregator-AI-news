require('dotenv').config();
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { exec } = require('child_process');
const cache = require('./cache-manager');

const PORT = 8000;
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_PREFIX = '/data/';

// Load credentials from environment variables
const MJ_AUTH_TOKEN = process.env.MJ_AUTH_TOKEN;
const CF_CLEARANCE = process.env.CF_CLEARANCE;

// Validate required environment variables
if (!MJ_AUTH_TOKEN || !CF_CLEARANCE) {
    console.error('❌ ERROR: Missing required environment variables!');
    console.error('Please check your .env file contains:');
    console.error('  - MJ_AUTH_TOKEN');
    console.error('  - CF_CLEARANCE');
    process.exit(1);
}

// API Gateway Helper Functions
function loadJSONFiles(directory, fileNames) {
    const results = [];
    for (const fileName of fileNames) {
        try {
            const filePath = path.join(directory, `${fileName}.json`);
            if (fs.existsSync(filePath)) {
                const rawData = fs.readFileSync(filePath, 'utf8');
                const data = JSON.parse(rawData);
                results.push(data);
            } else {
                console.warn(`File not found: ${filePath}`);
            }
        } catch (error) {
            console.error(`Error loading ${fileName}:`, error.message);
        }
    }
    return results;
}

function sendJSON(res, data, statusCode = 200, useCache = true, req = null) {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    // Add cache headers for API responses
    if (useCache) {
        headers['Cache-Control'] = 'public, max-age=300'; // 5 minutes
        headers['ETag'] = `"${Date.now()}"`;
    }

    const jsonString = JSON.stringify(data);

    // Check if client accepts gzip
    if (req && req.headers['accept-encoding']?.includes('gzip')) {
        headers['Content-Encoding'] = 'gzip';
        res.writeHead(statusCode, headers);
        zlib.gzip(jsonString, (err, compressed) => {
            if (err) {
                res.end(jsonString);
            } else {
                res.end(compressed);
            }
        });
    } else {
        res.writeHead(statusCode, headers);
        res.end(jsonString);
    }
}

function resolveMidjourneyImageUrl(item) {
    if (!item || typeof item !== 'object' || !item.id) {
        return null;
    }

    const localPath = path.join(DATA_DIR, 'midjourney', 'images', `${item.id}.png`);
    if (fs.existsSync(localPath)) {
        return `${DATA_PREFIX}midjourney/images/${item.id}.png`;
    }

    return null;
}

function normalizeMidjourneyPayload(payload) {
    if (!payload || !Array.isArray(payload.items)) {
        return payload;
    }

    return {
        ...payload,
        items: payload.items.map((item) => {
            const localImageUrl = resolveMidjourneyImageUrl(item);
            if (!localImageUrl) {
                return item;
            }

            return {
                ...item,
                imageUrl: localImageUrl,
                imageUrlHigh: localImageUrl
            };
        })
    };
}

const server = http.createServer((req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    // API Gateway: Telegram channels
    if (req.url === '/api/news/telegram') {
        try {
            const cacheKey = 'telegram_all';
            let data = cache.get(cacheKey);

            if (!data) {
                const telegramFiles = [
                    'seeallochnaya',
                    'web3ru',
                    'data_secrets',
                    'turboproject',
                    'ai_newz',
                    'cryptoEssay',
                    'denissexy',
                    'max_dot_sh'
                ];
                const telegramDir = path.join(DATA_DIR, 'tg');
                const feeds = loadJSONFiles(telegramDir, telegramFiles);

                data = {
                    source: 'telegram',
                    feeds: feeds,
                    count: feeds.length,
                    cached: false,
                    fetched_at: new Date().toISOString()
                };

                cache.set(cacheKey, data);
            } else {
                data.cached = true;
            }

            sendJSON(res, data, 200, true, req);
        } catch (error) {
            console.error('Error in /api/news/telegram:', error);
            sendJSON(res, { error: error.message }, 500);
        }
        return;
    }

    // API Gateway: RSS sources
    if (req.url === '/api/news/rss') {
        try {
            const cacheKey = 'rss_all';
            let data = cache.get(cacheKey);

            if (!data) {
                const rssFiles = [
                    'kdnuggets',
                    'mittech',
                    'deepmind',
                    'microsoft',
                    'habr_bigdata',
                    'habr_ai_ml',
                    'tds',
                    'openai',
                    'langchain',
                    'anthropic',
                    'meta_ai',
                    'venturebeat_ai'
                    // 'midjourney' removed - has its own separate gallery
                ];
                const rssDir = path.join(DATA_DIR, 'my-source-jsons');
                const feeds = loadJSONFiles(rssDir, rssFiles);

                data = {
                    source: 'rss',
                    feeds: feeds,
                    count: feeds.length,
                    cached: false,
                    fetched_at: new Date().toISOString()
                };

                cache.set(cacheKey, data);
            } else {
                data.cached = true;
            }

            sendJSON(res, data, 200, true, req);
        } catch (error) {
            console.error('Error in /api/news/rss:', error);
            sendJSON(res, { error: error.message }, 500);
        }
        return;
    }

    // API Gateway: News Aggregator (Hugging Face + Lobsters)
    if (req.url === '/api/news/aggregator') {
        try {
            const cacheKey = 'aggregator_all';
            let data = cache.get(cacheKey);

            if (!data) {
                const aggregatorFiles = ['huggingface', 'lobsters'];
                const aggregatorDir = path.join(DATA_DIR, 'news-aggregator-jsons');
                const feeds = loadJSONFiles(aggregatorDir, aggregatorFiles);

                data = {
                    source: 'aggregator',
                    feeds: feeds,
                    count: feeds.length,
                    cached: false,
                    fetched_at: new Date().toISOString()
                };

                cache.set(cacheKey, data);
            } else {
                data.cached = true;
            }

            sendJSON(res, data, 200, true, req);
        } catch (error) {
            console.error('Error in /api/news/aggregator:', error);
            sendJSON(res, { error: error.message }, 500);
        }
        return;
    }

    // API Gateway: Midjourney
    if (req.url === '/api/news/midjourney-data') {
        try {
            const cacheKey = 'midjourney_data';
            let data = cache.get(cacheKey);

            if (!data) {
                const midjourneyPath = path.join(DATA_DIR, 'midjourney', 'midjourney.json');
                if (fs.existsSync(midjourneyPath)) {
                    const rawData = fs.readFileSync(midjourneyPath, 'utf8');
                    const midjourneyData = JSON.parse(rawData);

                    data = {
                        source: 'midjourney',
                        ...midjourneyData,
                        cached: false,
                        fetched_at: new Date().toISOString()
                    };

                    cache.set(cacheKey, data);
                } else {
                    throw new Error('Midjourney data file not found');
                }
            } else {
                data.cached = true;
            }

            sendJSON(res, normalizeMidjourneyPayload(data), 200, true, req);
        } catch (error) {
            console.error('Error in /api/news/midjourney-data:', error);
            sendJSON(res, { error: error.message }, 500);
        }
        return;
    }

    // API Gateway: Cache stats (для отладки)
    if (req.url === '/api/cache/stats') {
        const stats = cache.getStats();
        sendJSON(res, stats, 200, false, req); // Don't cache stats
        return;
    }

    // API Gateway: Clear cache (для отладки)
    if (req.url === '/api/cache/clear' && req.method === 'POST') {
        cache.clear();
        sendJSON(res, { ok: true, message: 'Cache cleared' }, 200, false, req);
        return;
    }

    // API Gateway: Suggest Source
    if (req.url === '/api/suggest-source' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const timestamp = new Date().toISOString();
                const randomId = Math.random().toString(36).substring(2, 10);
                // Format: 20260121_aaquyp3e.json (YYYYMMDD_id.json)
                const dateStr = timestamp.split('T')[0].replace(/-/g, ''); // 2026-01-21 → 20260121
                const fileName = `${dateStr}_${randomId}.json`;
                const suggestionPath = path.join(DATA_DIR, 'user-suggestions', fileName);

                const suggestionData = {
                    suggestion: data.suggestion,
                    timestamp: timestamp,
                    userAgent: data.userAgent || 'unknown',
                    status: 'new'
                };

                // Save to JSON file
                fs.writeFileSync(suggestionPath, JSON.stringify(suggestionData, null, 2));

                console.log(`✓ New suggestion saved: ${fileName}`);

                // TODO: Send to Telegram (будущая функциональность)
                // await sendToTelegram(suggestionData);

                sendJSON(res, {
                    ok: true,
                    message: 'Suggestion received',
                    id: fileName
                });
            } catch (error) {
                console.error('Error saving suggestion:', error);
                sendJSON(res, { error: error.message }, 500);
            }
        });
        return;
    }

    // Handle Midjourney API proxy
    if (req.url.startsWith('/api/midjourney')) {
        const options = {
            hostname: 'www.midjourney.com',
            path: '/api/explore?page=0&feed=top&_ql=explore',
            method: 'GET',
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
                'Cookie': `__Host-Midjourney.AuthUserTokenV3_i=${MJ_AUTH_TOKEN}; cf_clearance=${CF_CLEARANCE}`,
                'Origin': 'https://www.midjourney.com',
                'Referer': 'https://www.midjourney.com/explore',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"macOS"'
            }
        };

        const proxyReq = https.request(options, (proxyRes) => {
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            });
            proxyRes.pipe(res);
        });

        proxyReq.on('error', (e) => {
            console.error('Proxy error:', e);
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message }));
        });

        proxyReq.end();
        return;
    }

    if (req.url.startsWith('/api/refresh')) {
        exec('node services/auto-refresh.js --force-once', { cwd: ROOT }, (error, stdout, stderr) => {
            if (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: error.message, stderr }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, output: stdout }));
        });
        return;
    }

    // Serve static files
    const isDataRequest = req.url.startsWith(DATA_PREFIX);
    const filePath = req.url === '/' ? '/index.html' : req.url;
    const fullPath = isDataRequest
        ? path.join(DATA_DIR, filePath.slice(DATA_PREFIX.length))
        : path.join(ROOT, filePath);

    const ext = path.extname(fullPath);
    const contentType = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
    }[ext] || 'text/plain';

    fs.readFile(fullPath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(500);
                res.end('Server error');
            }
        } else {
            const headers = { 'Content-Type': contentType };

            // Add cache headers for static files
            if (ext === '.html') {
                // HTML: cache for 5 minutes, must revalidate
                headers['Cache-Control'] = 'public, max-age=300, must-revalidate';
            } else if (['.js', '.css'].includes(ext)) {
                // JS/CSS: cache for 1 hour
                headers['Cache-Control'] = 'public, max-age=3600, immutable';
            } else if (['.png', '.jpg', '.gif', '.svg'].includes(ext)) {
                // Images: cache for 1 day
                headers['Cache-Control'] = 'public, max-age=86400, immutable';
            } else if (ext === '.json' && isDataRequest) {
                // Data JSON files: cache for 5 minutes
                headers['Cache-Control'] = 'public, max-age=300';
            }

            // Gzip compression for text files
            const shouldCompress = ['.html', '.js', '.css', '.json', '.svg'].includes(ext);
            if (shouldCompress && req.headers['accept-encoding']?.includes('gzip')) {
                headers['Content-Encoding'] = 'gzip';
                res.writeHead(200, headers);
                zlib.gzip(content, (err, compressed) => {
                    if (err) {
                        res.end(content);
                    } else {
                        res.end(compressed);
                    }
                });
            } else {
                res.writeHead(200, headers);
                res.end(content);
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
    console.log('\nAPI Gateway endpoints:');
    console.log(`  - http://localhost:${PORT}/api/news/telegram`);
    console.log(`  - http://localhost:${PORT}/api/news/rss`);
    console.log(`  - http://localhost:${PORT}/api/news/aggregator`);
    console.log(`  - http://localhost:${PORT}/api/news/midjourney-data`);
    console.log(`  - http://localhost:${PORT}/api/cache/stats`);
    console.log('\nLegacy endpoints:');
    console.log(`  - http://localhost:${PORT}/api/midjourney (proxy)`);
    console.log(`  - http://localhost:${PORT}/api/refresh`);
});
