/**
 * RSS АГРЕГАТОР С ПОДДЕРЖКОЙ МНОЖЕСТВЕННЫХ ИСТОЧНИКОВ
 *
 * Система работает с тремя типами источников:
 *
 * 1. RSS ФИДЫ (Метод: прямые HTTP запросы)
 *    - Самый быстрый и надежный метод
 *    - Не требует парсинга HTML
 *    - Примеры: OpenAI, LangChain, KDnuggets, MIT Tech Review
 *    - Реализация: fetchRSS() -> parseRSSToJSON()
 *
 * 2. HTML ПАРСИНГ (Метод: requests + BeautifulSoup)
 *    - Для сайтов без RSS фида
 *    - Парсинг статического HTML
 *    - Примеры: Anthropic, Meta AI
 *    - Реализация: parsers/web-scraper.py
 *
 * 3. SELENIUM ПАРСИНГ (Метод: headless Chrome + JavaScript)
 *    - Для сайтов с динамической загрузкой контента
 *    - Требует Chrome/Chromium
 *    - Примеры: VentureBeat AI
 *    - Реализация: parsers/web-scraper-selenium.py
 *
 * Список источников: config/sources_list.txt
 *
 * API Endpoints:
 *   GET /api/rss/<feed_name>  - Получить конкретный фид
 *   GET /api/rss/all          - Получить все фиды
 *
 * Добавление нового источника:
 *   1. Добавить URL в RSS_FEEDS (для RSS)
 *   2. Добавить в SCRAPED_SITES (для HTML парсинга)
 *   3. Добавить в SELENIUM_SITES (для JavaScript сайтов)
 *   4. Обновить config/sources_list.txt
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { parseString } = require('xml2js');
const { exec } = require('child_process');
const { promisify } = require('util');
const { atomicWriteJSON } = require('./atomic-write');

const execAsync = promisify(exec);
const PORT = 8001;
const ROOT = path.resolve(__dirname, '..');
const JSONS_DIR = path.join(ROOT, 'data', 'my-source-jsons');
const TIME_JSON_PATH = path.join(ROOT, 'etc', 'time.json');
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

function utcDateKey(date) {
    return date.toISOString().split('T')[0];
}

function readLastUpdate() {
    try {
        const raw = fs.readFileSync(TIME_JSON_PATH, 'utf8');
        const data = JSON.parse(raw);
        return data.lastUpdate ? new Date(data.lastUpdate) : null;
    } catch (error) {
        return null;
    }
}

// Note: time.json is now managed only by auto-refresh.js to avoid conflicts
// RSS server only reads it to determine if cache is valid

function shouldRefresh() {
    const lastUpdate = readLastUpdate();
    if (!lastUpdate || Number.isNaN(lastUpdate.getTime())) {
        return true;
    }

    const now = new Date();
    const elapsedMs = now - lastUpdate;
    const isNewDay = utcDateKey(now) !== utcDateKey(lastUpdate);

    return isNewDay || elapsedMs >= REFRESH_INTERVAL;
}

function loadCachedFeed(feedName) {
    try {
        const filePath = path.join(JSONS_DIR, `${feedName}.json`);
        if (!fs.existsSync(filePath)) {
            return null;
        }
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (error) {
        console.error(`Error reading cached feed ${feedName}:`, error.message);
        return null;
    }
}

function loadCachedFeeds(feedEntries) {
    return feedEntries.map(({ name }) => {
        const cached = loadCachedFeed(name);
        if (cached) {
            return cached;
        }
        return {
            feed: name,
            items: [],
            count: 0,
            cached: false,
            fetched_at: null
        };
    });
}

// МЕТОД 1: RSS фиды (прямые HTTP запросы)
const RSS_FEEDS = {
    kdnuggets: 'https://www.kdnuggets.com/feed',
    mittech: 'https://www.technologyreview.com/topic/artificial-intelligence/feed',
    deepmind: 'https://deepmind.google/blog/rss.xml',
    microsoft: 'https://blogs.microsoft.com/feed/',
    habr_bigdata: 'https://habr.com/ru/rss/hubs/bigdata/articles/all/?fl=ru',
    tds: 'https://towardsdatascience.com/latest/feed',
    openai: 'https://openai.com/news/rss.xml',
    langchain: 'https://blog.langchain.com/rss/'
};

// Combined feeds that need special handling
const COMBINED_FEEDS = {
    habr_ai_ml: {
        sources: [
            'https://habr.com/ru/rss/hubs/artificial_intelligence/articles/all/?fl=ru',
            'https://habr.com/ru/rss/hubs/machine_learning/articles/all/?fl=ru'
        ]
    }
};

// МЕТОД 2: HTML парсинг (requests + BeautifulSoup)
const SCRAPED_SITES = {
    anthropic: 'anthropic',
    meta_ai: 'meta_ai'
};

// МЕТОД 3: Selenium парсинг (headless Chrome + JavaScript)
const SELENIUM_SITES = {
    venturebeat_ai: 'venturebeat_ai',
    midjourney: 'midjourney'
};

function fetchRSS(url, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        if (redirectCount > 5) {
            reject(new Error('Too many redirects'));
            return;
        }

        https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Accept': 'application/rss+xml, application/xml, text/xml, */*'
            }
        }, (res) => {
            // Handle redirects
            if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
                let redirectUrl = res.headers.location;
                if (redirectUrl) {
                    // Handle relative redirects
                    if (redirectUrl.startsWith('/')) {
                        const urlObj = new URL(url);
                        redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
                    }
                    fetchRSS(redirectUrl, redirectCount + 1).then(resolve).catch(reject);
                    return;
                }
            }

            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}`));
                }
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

function parseRSSToJSON(xmlData) {
    return new Promise((resolve, reject) => {
        parseString(xmlData, { trim: true, explicitArray: false }, (err, result) => {
            if (err) {
                reject(err);
                return;
            }

            try {
                let items = [];

                // Handle RSS 2.0 format
                if (result.rss && result.rss.channel && result.rss.channel.item) {
                    const channel = result.rss.channel;
                    const rawItems = Array.isArray(channel.item) ? channel.item : [channel.item];

                    items = rawItems.map(item => ({
                        title: item.title || '',
                        link: item.link || '',
                        description: item.description || item['content:encoded'] || '',
                        pubDate: item.pubDate || '',
                        author: item['dc:creator'] || item.author || 'Unknown',
                        categories: Array.isArray(item.category) ? item.category : (item.category ? [item.category] : [])
                    }));
                }
                // Handle Atom format
                else if (result.feed && result.feed.entry) {
                    const rawEntries = Array.isArray(result.feed.entry) ? result.feed.entry : [result.feed.entry];

                    items = rawEntries.map(entry => ({
                        title: entry.title._ || entry.title || '',
                        link: entry.link ? (entry.link.$ ? entry.link.$.href : entry.link) : '',
                        description: entry.summary ? (entry.summary._ || entry.summary) : (entry.content ? (entry.content._ || entry.content) : ''),
                        pubDate: entry.updated || entry.published || '',
                        author: entry.author ? (entry.author.name || 'Unknown') : 'Unknown',
                        categories: []
                    }));
                }

                resolve(items);
            } catch (err) {
                reject(err);
            }
        });
    });
}

function saveFeedJSON(feedName, payload) {
    try {
        const filePath = path.join(JSONS_DIR, `${feedName}.json`);
        const success = atomicWriteJSON(filePath, payload);
        if (!success) {
            console.error(`Failed to save JSON for ${feedName}`);
        }
    } catch (error) {
        console.error(`Error saving JSON for ${feedName}:`, error.message);
    }
}

// Функция для получения объединенных фидов
async function fetchCombinedFeed(feedName) {
    try {
        const config = COMBINED_FEEDS[feedName];
        if (!config) {
            throw new Error(`Combined feed ${feedName} not configured`);
        }

        // Fetch all source feeds in parallel
        const feedPromises = config.sources.map(url =>
            fetchRSS(url).then(parseRSSToJSON).catch(err => {
                console.error(`Error fetching combined feed source ${url}:`, err.message);
                return [];
            })
        );

        const allItems = await Promise.all(feedPromises);

        // Merge and deduplicate by link
        const mergedItems = [];
        const seenLinks = new Set();

        allItems.forEach(items => {
            items.forEach(item => {
                if (!seenLinks.has(item.link)) {
                    seenLinks.add(item.link);
                    mergedItems.push(item);
                }
            });
        });

        // Sort by pubDate (newest first)
        mergedItems.sort((a, b) => {
            const dateA = new Date(a.pubDate);
            const dateB = new Date(b.pubDate);
            return dateB - dateA;
        });

        return mergedItems;
    } catch (error) {
        console.error(`Error fetching combined feed ${feedName}:`, error.message);
        return [];
    }
}

// Функция для HTML парсинга (requests + BeautifulSoup)
async function scrapeWebsite(siteName) {
    try {
        const { stdout, stderr } = await execAsync(`python3 parsers/web-scraper.py ${siteName}`, { cwd: ROOT });

        if (stderr) {
            console.error(`Scraper stderr for ${siteName}:`, stderr);
        }

        const result = JSON.parse(stdout);
        return result.items || [];
    } catch (error) {
        console.error(`Error scraping ${siteName}:`, error.message);
        return [];
    }
}

// Функция для Selenium парсинга (headless Chrome + JavaScript)
async function scrapeWithSelenium(siteName) {
    try {
        const { stdout, stderr } = await execAsync(`python3 parsers/web-scraper-selenium.py ${siteName}`, { cwd: ROOT });

        if (stderr) {
            console.error(`Selenium scraper stderr for ${siteName}:`, stderr);
        }

        const result = JSON.parse(stdout);
        return result.items || [];
    } catch (error) {
        console.error(`Error scraping with Selenium ${siteName}:`, error.message);
        return [];
    }
}

const server = http.createServer(async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Handle all feeds request (must be before individual feed handler)
    if (req.url.startsWith('/api/rss/all')) {
        try {
            // Check for force parameter
            const url = new URL(req.url, `http://${req.headers.host}`);
            const forceRefresh = url.searchParams.get('force') === 'true';

            const refreshNeeded = forceRefresh || shouldRefresh();
            console.log(`Fetching all RSS feeds... (force: ${forceRefresh}, shouldRefresh: ${shouldRefresh()})`);

            const feedEntries = [
                ...Object.keys(RSS_FEEDS).map((name) => ({ name, type: 'rss' })),
                ...Object.keys(COMBINED_FEEDS).map((name) => ({ name, type: 'combined' })),
                ...Object.keys(SCRAPED_SITES).map((name) => ({ name, type: 'scraper' })),
                ...Object.keys(SELENIUM_SITES).map((name) => ({ name, type: 'selenium' }))
            ];

            if (!refreshNeeded) {
                const cachedFeeds = loadCachedFeeds(feedEntries);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ feeds: cachedFeeds, cached: true }));
                return;
            }

            const allFeeds = await Promise.all(
                feedEntries.map(async ({ name, type }) => {
                    try {
                        if (type === 'rss') {
                            const xmlData = await fetchRSS(RSS_FEEDS[name]);
                            const items = await parseRSSToJSON(xmlData);
                            const payload = {
                                feed: name,
                                source: 'rss',
                                method: 'Direct HTTP',
                                url: RSS_FEEDS[name],
                                items: items,
                                count: items.length,
                                fetched_at: new Date().toISOString()
                            };
                            saveFeedJSON(name, payload);
                            return payload;
                        }

                        if (type === 'combined') {
                            const items = await fetchCombinedFeed(name);
                            const payload = {
                                feed: name,
                                source: 'rss-combined',
                                method: 'Combined RSS feeds',
                                items: items,
                                count: items.length,
                                fetched_at: new Date().toISOString()
                            };
                            saveFeedJSON(name, payload);
                            return payload;
                        }

                        if (type === 'scraper') {
                            const items = await scrapeWebsite(name);
                            const payload = {
                                feed: name,
                                source: 'web-scraper',
                                method: 'HTML parsing',
                                items: items,
                                count: items.length,
                                fetched_at: new Date().toISOString()
                            };
                            saveFeedJSON(name, payload);
                            return payload;
                        }

                        const items = await scrapeWithSelenium(name);
                        const payload = {
                            feed: name,
                            source: 'selenium-scraper',
                            method: 'JavaScript rendering',
                            items: items,
                            count: items.length,
                            fetched_at: new Date().toISOString()
                        };
                        saveFeedJSON(name, payload);
                        return payload;
                    } catch (error) {
                        console.error(`Error fetching ${name}:`, error.message);
                        const payload = {
                            feed: name,
                            error: error.message,
                            items: [],
                            count: 0,
                            fetched_at: new Date().toISOString()
                        };
                        saveFeedJSON(name, payload);
                        return payload;
                    }
                })
            );

            // time.json is now managed by auto-refresh.js only

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ feeds: allFeeds }));
        } catch (error) {
            console.error('Error fetching all feeds:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    // Handle individual RSS feed requests
    if (req.url.startsWith('/api/rss/')) {
        const feedName = req.url.replace('/api/rss/', '').split('?')[0];
        const refreshNeeded = shouldRefresh();

        // Check if it's a combined feed
        if (COMBINED_FEEDS[feedName]) {
            try {
                if (!refreshNeeded) {
                    const cached = loadCachedFeed(feedName);
                    if (cached) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(cached));
                        return;
                    }
                }
                console.log(`Fetching combined feed: ${feedName}`);
                const items = await fetchCombinedFeed(feedName);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                const payload = {
                    feed: feedName,
                    source: 'rss-combined',
                    method: 'Combined RSS feeds',
                    items: items,
                    count: items.length,
                    fetched_at: new Date().toISOString()
                };
                saveFeedJSON(feedName, payload);
                if (refreshNeeded) {
                    updateTimeJson();
                }
                res.end(JSON.stringify(payload));
            } catch (error) {
                console.error(`Error fetching combined feed ${feedName}:`, error.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
            return;
        }

        // МЕТОД 3: Check if it's a Selenium site (JavaScript-rendered)
        if (SELENIUM_SITES[feedName]) {
            try {
                if (!refreshNeeded) {
                    const cached = loadCachedFeed(feedName);
                    if (cached) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(cached));
                        return;
                    }
                }
                console.log(`Scraping with Selenium: ${feedName}`);
                const items = await scrapeWithSelenium(feedName);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                const payload = {
                    feed: feedName,
                    source: 'selenium-scraper',
                    method: 'JavaScript rendering',
                    items: items,
                    count: items.length,
                    fetched_at: new Date().toISOString()
                };
                saveFeedJSON(feedName, payload);
                if (refreshNeeded) {
                    updateTimeJson();
                }
                res.end(JSON.stringify(payload));
            } catch (error) {
                console.error(`Error scraping with Selenium ${feedName}:`, error.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
            return;
        }

        // МЕТОД 2: Check if it's a HTML scraped site
        if (SCRAPED_SITES[feedName]) {
            try {
                if (!refreshNeeded) {
                    const cached = loadCachedFeed(feedName);
                    if (cached) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(cached));
                        return;
                    }
                }
                console.log(`Scraping website: ${feedName}`);
                const items = await scrapeWebsite(feedName);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                const payload = {
                    feed: feedName,
                    source: 'web-scraper',
                    method: 'HTML parsing',
                    items: items,
                    count: items.length,
                    fetched_at: new Date().toISOString()
                };
                saveFeedJSON(feedName, payload);
                if (refreshNeeded) {
                    updateTimeJson();
                }
                res.end(JSON.stringify(payload));
            } catch (error) {
                console.error(`Error scraping ${feedName}:`, error.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
            return;
        }

        // МЕТОД 1: Check if it's an RSS feed
        if (!RSS_FEEDS[feedName]) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: 'Feed not found',
                available: {
                    rss: Object.keys(RSS_FEEDS),
                    scraped: Object.keys(SCRAPED_SITES),
                    selenium: Object.keys(SELENIUM_SITES)
                }
            }));
            return;
        }

        try {
            if (!refreshNeeded) {
                const cached = loadCachedFeed(feedName);
                if (cached) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(cached));
                    return;
                }
            }
            console.log(`Fetching RSS: ${feedName}`);
            const xmlData = await fetchRSS(RSS_FEEDS[feedName]);
            const items = await parseRSSToJSON(xmlData);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            const payload = {
                feed: feedName,
                source: 'rss',
                method: 'Direct HTTP',
                url: RSS_FEEDS[feedName],
                items: items,
                count: items.length,
                fetched_at: new Date().toISOString()
            };
            saveFeedJSON(feedName, payload);
            // time.json is now managed by auto-refresh.js only
            res.end(JSON.stringify(payload));
        } catch (error) {
            console.error(`Error fetching RSS ${feedName}:`, error.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    // Default response
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        error: 'Not found',
        available: Object.keys(RSS_FEEDS).map(name => `/api/rss/${name}`)
    }));
});

server.listen(PORT, () => {
    console.log(`RSS Server running at http://localhost:${PORT}/`);
    console.log('Available RSS feeds:');
    Object.keys(RSS_FEEDS).forEach(name => {
        console.log(`  - http://localhost:${PORT}/api/rss/${name}`);
    });
    console.log(`  - http://localhost:${PORT}/api/rss/all (all feeds combined)`);
});
