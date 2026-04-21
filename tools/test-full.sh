#!/bin/bash

echo "🧪 Запуск полного тестирования бота..."
echo ""

# Цвета
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

passed=0
failed=0
warnings=0

# Функция для проверки
check() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $1"
        ((passed++))
    else
        echo -e "${RED}✗${NC} $1"
        ((failed++))
    fi
}

# Функция для предупреждения
warn() {
    echo -e "${YELLOW}⚠${NC} $1"
    ((warnings++))
}

# Функция для заголовка
header() {
    echo ""
    echo -e "${BLUE}━━━ $1 ━━━${NC}"
}

# ==========================================
# Этап 1: Docker
# ==========================================
header "Этап 1: Проверка Docker"

docker compose ps | grep -q "tst_site-app-1.*Up"
check "Контейнер app запущен"

docker compose ps | grep -q "tst_site-selenium-1.*Up"
check "Контейнер selenium запущен"

# Проверка логов на ошибки
if ! docker compose logs app --tail 50 | grep -qi "error.*failed\|econnrefused"; then
    check "Логи app чистые"
else
    warn "В логах app есть ошибки"
fi

# ==========================================
# Этап 2: Сервисы
# ==========================================
header "Этап 2: Проверка сервисов"

curl -sf http://localhost:4444/wd/hub/status | jq -e '.value.ready == true' > /dev/null 2>&1
check "Selenium готов к работе"

curl -sf http://localhost:8000/ > /dev/null
check "Главная страница доступна (port 8000)"

curl -sf http://localhost:8001/api/rss/all > /dev/null
check "RSS сервер доступен (port 8001)"

# ==========================================
# Этап 3: API Gateway
# ==========================================
header "Этап 3: Проверка API Gateway"

curl -sf http://localhost:8000/api/news/telegram | jq -e '.feeds | length > 0' > /dev/null 2>&1
check "API /api/news/telegram работает"

curl -sf http://localhost:8000/api/news/rss | jq -e '.feeds | length > 0' > /dev/null 2>&1
check "API /api/news/rss работает"

curl -sf http://localhost:8000/api/news/aggregator | jq -e '.feeds | length > 0' > /dev/null 2>&1
check "API /api/news/aggregator работает"

curl -sf http://localhost:8000/api/news/midjourney-data | jq -e '.count' > /dev/null 2>&1
check "API /api/news/midjourney-data работает"

curl -sf http://localhost:8000/api/cache/stats > /dev/null
check "API /api/cache/stats работает"

# ==========================================
# Этап 4: Файлы данных
# ==========================================
header "Этап 4: Проверка файлов данных"

if [ -f "etc/time.json" ]; then
    cat etc/time.json | jq -e '.lastUpdate' > /dev/null 2>&1
    check "time.json существует и валиден"

    cat etc/time.json | jq -e '.history | length > 0' > /dev/null 2>&1
    check "История обновлений присутствует"

    # Проверка формата времени (MSK)
    if cat etc/time.json | jq -r '.lastUpdate' | grep -q "+03:00"; then
        check "Время в формате MSK (+03:00)"
    else
        warn "Время не в формате MSK"
    fi
else
    warn "time.json не найден"
fi

# Telegram данные
tg_count=$(ls -1 data/tg/*.json 2>/dev/null | wc -l | tr -d ' ')
if [ "$tg_count" -gt 0 ]; then
    check "Telegram данные: $tg_count файлов"
else
    warn "Telegram данные отсутствуют"
fi

# RSS данные
rss_count=$(ls -1 data/my-source-jsons/*.json 2>/dev/null | wc -l | tr -d ' ')
if [ "$rss_count" -gt 0 ]; then
    check "RSS данные: $rss_count файлов"
else
    warn "RSS данные отсутствуют"
fi

# Aggregator данные
if [ -f "data/news-aggregator-jsons/huggingface.json" ]; then
    check "Hugging Face данные существуют"
else
    warn "Hugging Face данные отсутствуют"
fi

if [ -f "data/news-aggregator-jsons/lobsters.json" ]; then
    check "Lobsters данные существуют"
else
    warn "Lobsters данные отсутствуют"
fi

# Midjourney данные
if [ -f "data/midjourney/midjourney.json" ]; then
    mj_count=$(cat data/midjourney/midjourney.json | jq -r '.count' 2>/dev/null)
    if [ "$mj_count" -gt 0 ]; then
        check "Midjourney данные: $mj_count изображений"
    else
        warn "Midjourney данные пустые"
    fi
else
    warn "Midjourney данные отсутствуют"
fi

# ==========================================
# Этап 5: Переменные окружения
# ==========================================
header "Этап 5: Проверка переменных окружения"

if docker compose exec app printenv | grep -q "REFRESH_INTERVAL_HOURS=5"; then
    check "REFRESH_INTERVAL_HOURS настроен"
else
    warn "REFRESH_INTERVAL_HOURS не найден"
fi

if docker compose exec app printenv | grep -q "TELEGRAM_API_ID"; then
    check "TELEGRAM_API_ID настроен"
else
    warn "TELEGRAM_API_ID не найден"
fi

# ==========================================
# Этап 6: Производительность
# ==========================================
header "Этап 6: Проверка производительности"

# Проверка времени ответа главной страницы
response_time=$(curl -o /dev/null -s -w '%{time_total}' http://localhost:8000/)
if (( $(echo "$response_time < 1.0" | bc -l) )); then
    check "Время ответа главной страницы: ${response_time}s"
else
    warn "Медленный ответ главной страницы: ${response_time}s"
fi

# Проверка использования памяти
mem_usage=$(docker stats --no-stream --format "{{.MemUsage}}" tst_site-app-1 2>/dev/null | cut -d'/' -f1)
if [ -n "$mem_usage" ]; then
    check "Использование памяти app: $mem_usage"
else
    warn "Не удалось получить информацию о памяти"
fi

# ==========================================
# Итоги
# ==========================================
echo ""
echo "========================================="
echo -e "${GREEN}Успешно:${NC} $passed"
echo -e "${RED}Ошибок:${NC} $failed"
echo -e "${YELLOW}Предупреждений:${NC} $warnings"
echo "========================================="

if [ $failed -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓ Все критичные тесты пройдены!${NC}"
    if [ $warnings -gt 0 ]; then
        echo -e "${YELLOW}⚠ Есть предупреждения, но система работоспособна${NC}"
    fi
    echo ""
    echo "🚀 Система готова к тестированию в браузере!"
    echo "   Откройте: http://localhost:8000"
    exit 0
else
    echo ""
    echo -e "${RED}✗ Обнаружены критичные ошибки!${NC}"
    echo ""
    echo "Рекомендации:"
    echo "1. Проверьте логи: docker compose logs app"
    echo "2. Перезапустите контейнеры: docker compose restart"
    echo "3. Запустите обновление данных: docker compose exec app npm run refresh:now"
    exit 1
fi
