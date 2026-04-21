/**
 * Telegram Notifier Service
 *
 * DRAFT: Черновик для будущей функциональности отправки предложений в Telegram
 *
 * Использование:
 * - Когда пользователь отправляет предложение через форму "Suggest a Source"
 * - Уведомление будет отправлено в указанный Telegram канал/чат
 *
 * TODO: Реализовать отправку в Telegram
 */

const https = require('https');

/**
 * Отправка сообщения в Telegram
 * @param {Object} suggestionData - Данные предложения
 * @param {string} suggestionData.suggestion - Текст предложения
 * @param {string} suggestionData.timestamp - Время отправки
 * @param {string} suggestionData.userAgent - User Agent пользователя
 * @returns {Promise<boolean>} - Успешность отправки
 */
async function sendToTelegram(suggestionData) {
    // TODO: Получить из .env
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_NOTIFIER_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_NOTIFIER_CHAT_ID;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.warn('Telegram credentials not configured. Skipping notification.');
        return false;
    }

    try {
        const message = formatMessage(suggestionData);

        const data = JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        });

        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let responseData = '';

                res.on('data', (chunk) => {
                    responseData += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode === 200) {
                        console.log('✓ Telegram notification sent successfully');
                        resolve(true);
                    } else {
                        console.error('✗ Telegram notification failed:', responseData);
                        resolve(false);
                    }
                });
            });

            req.on('error', (error) => {
                console.error('✗ Telegram request error:', error);
                reject(error);
            });

            req.write(data);
            req.end();
        });

    } catch (error) {
        console.error('Error sending to Telegram:', error);
        return false;
    }
}

/**
 * Форматирование сообщения для Telegram
 * @param {Object} suggestionData - Данные предложения
 * @returns {string} - Форматированное сообщение
 */
function formatMessage(suggestionData) {
    const date = new Date(suggestionData.timestamp);
    const dateStr = date.toLocaleString('ru-RU', {
        timeZone: 'Europe/Moscow',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });

    return `
🔔 <b>New Source Suggestion</b>

📝 <b>Suggestion:</b>
${suggestionData.suggestion}

⏰ <b>Time:</b> ${dateStr} MSK
🌐 <b>User Agent:</b> ${suggestionData.userAgent}

#suggestion #newsource
    `.trim();
}

/**
 * Тестовая отправка
 * Запуск: node services/telegram-notifier.js
 */
if (require.main === module) {
    const testData = {
        suggestion: 'https://openai.com/blog - OpenAI official blog has great articles about AI research',
        timestamp: new Date().toISOString(),
        userAgent: 'Test User Agent'
    };

    sendToTelegram(testData)
        .then(() => {
            console.log('Test completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Test failed:', error);
            process.exit(1);
        });
}

module.exports = { sendToTelegram };
