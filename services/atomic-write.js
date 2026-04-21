/**
 * Atomic Write Utility
 * Provides atomic file writing to prevent corrupted files
 *
 * How it works:
 * 1. Write to temporary file
 * 2. Atomically rename temp file to target file
 * 3. If anything fails, original file remains intact
 */

const fs = require('fs');
const path = require('path');

/**
 * Atomically write data to a JSON file
 * @param {string} filePath - Target file path
 * @param {object} data - Data to write (will be JSON.stringify'd)
 * @param {object} options - Options
 * @param {number} options.indent - JSON indentation (default: 2)
 * @returns {boolean} - Success status
 */
function atomicWriteJSON(filePath, data, options = {}) {
    const indent = options.indent !== undefined ? options.indent : 2;

    try {
        // Create directory if it doesn't exist
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Generate unique temporary file name
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(7);
        const tempFile = `${filePath}.tmp.${timestamp}.${random}`;

        // Step 1: Write to temporary file
        const jsonString = JSON.stringify(data, null, indent);
        fs.writeFileSync(tempFile, jsonString, 'utf8');

        // Step 2: Atomically rename (this is the atomic operation!)
        fs.renameSync(tempFile, filePath);

        return true;
    } catch (error) {
        console.error(`[Atomic Write] Failed to write ${filePath}:`, error.message);

        // Cleanup: try to remove temp file if it exists
        try {
            const tempPattern = `${filePath}.tmp.`;
            const dir = path.dirname(filePath);
            const files = fs.readdirSync(dir);
            files.forEach(file => {
                if (file.startsWith(path.basename(filePath) + '.tmp.')) {
                    const tempPath = path.join(dir, file);
                    fs.unlinkSync(tempPath);
                }
            });
        } catch (cleanupError) {
            // Ignore cleanup errors
        }

        return false;
    }
}

/**
 * Atomically write raw text to a file
 * @param {string} filePath - Target file path
 * @param {string} content - Content to write
 * @returns {boolean} - Success status
 */
function atomicWriteFile(filePath, content) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(7);
        const tempFile = `${filePath}.tmp.${timestamp}.${random}`;

        fs.writeFileSync(tempFile, content, 'utf8');
        fs.renameSync(tempFile, filePath);

        return true;
    } catch (error) {
        console.error(`[Atomic Write] Failed to write ${filePath}:`, error.message);
        return false;
    }
}

module.exports = {
    atomicWriteJSON,
    atomicWriteFile
};
