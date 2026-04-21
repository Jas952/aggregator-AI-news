/**
 * In-Memory Cache Manager
 * Кеширует JSON данные в оперативной памяти с TTL (Time To Live)
 * Устраняет race condition и ускоряет загрузку
 */

class CacheManager {
    constructor() {
        this.cache = new Map();
        this.defaultTTL = 5 * 60 * 1000; // 5 минут в миллисекундах
    }

    /**
     * Получить данные из кеша
     * @param {string} key - Ключ кеша
     * @returns {any|null} - Данные или null, если кеш устарел/отсутствует
     */
    get(key) {
        const entry = this.cache.get(key);

        if (!entry) {
            return null;
        }

        const now = Date.now();
        if (now > entry.expiresAt) {
            // Кеш устарел, удаляем
            this.cache.delete(key);
            return null;
        }

        return entry.data;
    }

    /**
     * Сохранить данные в кеш
     * @param {string} key - Ключ кеша
     * @param {any} data - Данные для кеширования
     * @param {number} ttl - TTL в миллисекундах (опционально)
     */
    set(key, data, ttl = this.defaultTTL) {
        const now = Date.now();
        this.cache.set(key, {
            data: data,
            cachedAt: now,
            expiresAt: now + ttl
        });
    }

    /**
     * Инвалидировать (удалить) кеш по ключу
     * @param {string} key - Ключ кеша
     */
    invalidate(key) {
        this.cache.delete(key);
    }

    /**
     * Очистить весь кеш
     */
    clear() {
        this.cache.clear();
    }

    /**
     * Получить статистику кеша
     * @returns {object} - Статистика
     */
    getStats() {
        const now = Date.now();
        let validEntries = 0;
        let expiredEntries = 0;

        this.cache.forEach((entry) => {
            if (now > entry.expiresAt) {
                expiredEntries++;
            } else {
                validEntries++;
            }
        });

        return {
            total: this.cache.size,
            valid: validEntries,
            expired: expiredEntries
        };
    }
}

module.exports = new CacheManager();
