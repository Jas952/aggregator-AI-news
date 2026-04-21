#!/usr/bin/env node
/**
 * Midjourney Image Scraper
 *
 * Автоматический парсер изображений с Midjourney
 * Использует Selenium для обхода Cloudflare protection
 * Сохраняет результаты в data/midjourney/midjourney.json
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { atomicWriteJSON } = require('../services/atomic-write');

const execAsync = promisify(exec);
const MIDJOURNEY_DIR = path.join(__dirname, '..', 'data', 'midjourney');
const MIDJOURNEY_JSON = path.join(MIDJOURNEY_DIR, 'midjourney.json');

async function scrapeMidjourney() {
    try {
        console.log('Starting Midjourney scraper...');

        // Ensure directory exists
        if (!fs.existsSync(MIDJOURNEY_DIR)) {
            fs.mkdirSync(MIDJOURNEY_DIR, { recursive: true });
            console.log('Created midjourney directory');
        }

        // Run Selenium scraper
        const { stdout, stderr } = await execAsync('python3 parsers/web-scraper-selenium.py midjourney', { cwd: path.join(__dirname, '..') });

        if (stderr) {
            console.error('Scraper stderr:', stderr);
        }

        // Parse and save result
        const result = JSON.parse(stdout);
        const success = atomicWriteJSON(MIDJOURNEY_JSON, result);

        if (success) {
            console.log(`✓ Scraped ${result.count} images from Midjourney`);
            console.log(`✓ Saved to ${MIDJOURNEY_JSON}`);
        } else {
            console.error('✗ Failed to save Midjourney data');
        }

        return result;

    } catch (error) {
        console.error('Error scraping Midjourney:', error.message);
        throw error;
    }
}

// Run if called directly
if (require.main === module) {
    scrapeMidjourney()
        .then(() => {
            console.log('Midjourney scraper completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Midjourney scraper failed:', error);
            process.exit(1);
        });
}

module.exports = { scrapeMidjourney };
