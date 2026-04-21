import asyncio
from telethon import TelegramClient
import json
from datetime import datetime, timezone
import os
from pathlib import Path
import re
from atomic_write import atomic_write_json

# ----------------------------------------
# 🔐 ВАШИ ДАННЫЕ (берем только из .env)
# ----------------------------------------
session_name = str(Path("etc") / "parsing_tg")  # Имя файла сессии (создастся само)

# Список каналов (можно использовать username или ID)
def _load_channels() -> list:
    config_path = Path("config") / "tg_channels.json"
    if not config_path.exists():
        raise FileNotFoundError("Missing config/tg_channels.json with Telegram channel list.")
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    channels = payload.get("channels", [])
    if not isinstance(channels, list) or not channels:
        raise ValueError("config/tg_channels.json must contain non-empty 'channels' list.")
    return channels

channels_to_parse = _load_channels()
# ----------------------------------------

# Подгружаем .env, если есть (без внешних зависимостей)
def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):]
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value

_load_env_file(Path(".env"))

def _resolve_api_id() -> int:
    raw = os.getenv("TELEGRAM_API_ID", "").strip()
    if raw.isdigit():
        return int(raw)
    raise ValueError("Missing TELEGRAM_API_ID in .env (must be a number).")

def _resolve_api_hash() -> str:
    raw = os.getenv("TELEGRAM_API_HASH", "").strip()
    if raw:
        return raw
    raise ValueError("Missing TELEGRAM_API_HASH in .env.")

api_id = _resolve_api_id()
api_hash = _resolve_api_hash()

# Создаем клиент
client = TelegramClient(session_name, api_id, api_hash)

def _extract_message_text(message) -> str:
    candidates = [
        getattr(message, "message", None),
        getattr(message, "raw_text", None),
        getattr(message, "text", None),
    ]
    for candidate in candidates:
        if candidate:
            return candidate
    media = getattr(message, "media", None)
    if media:
        caption = getattr(media, "caption", None)
        if caption:
            return caption
    return ""

async def fetch_news():
    print("🚀 Подключаюсь к Telegram API...")
    news_by_channel = {}

    for channel in channels_to_parse:
        try:
            print(f"📡 Сканирую: {channel}...")

            # Получаем сам объект канала (entity)
            entity = await client.get_entity(channel)
            channel_items = []
            grouped_texts = {}  # Store texts for grouped media
            seen_grouped_ids = set()
            seen_text_keys = set()

            # First pass: collect all messages to find grouped media texts
            all_messages = []
            async for message in client.iter_messages(entity, limit=20):  # Increased limit to catch grouped messages
                if not message.text and not message.media:
                    continue
                all_messages.append(message)

                # If message has text and is part of a group, store it
                if message.grouped_id and message.text:
                    grouped_texts[message.grouped_id] = message.text

            # Second pass: process messages
            processed_count = 0
            for message in all_messages:
                if processed_count >= 5:  # Only take 5 final items
                    break
                
                # Пропускаем сервисные сообщения и пустые (без текста/медиа)
                if not message.text and not message.media:
                    continue
                
                # Пропускаем дубли из альбомов (одно сообщение = одна запись)
                if message.grouped_id:
                    if message.grouped_id in seen_grouped_ids:
                        continue
                    seen_grouped_ids.add(message.grouped_id)

                # Формируем ссылку на пост
                # Для публичных каналов: t.me/username/id
                # Для приватных структура сложнее, но для агрегатора нужна публичная
                if hasattr(entity, 'username') and entity.username:
                    post_link = f"https://t.me/{entity.username}/{message.id}"
                else:
                    post_link = f"https://t.me/c/{entity.id}/{message.id}"

                text = _extract_message_text(message)

                # If no text but message is part of grouped media, try to get text from the group
                if not text and message.grouped_id and message.grouped_id in grouped_texts:
                    text = grouped_texts[message.grouped_id]

                pub_date = message.date.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
                preview = _build_preview(text, 120)
                if preview:
                    text_key = (preview.lower(), pub_date[:19])
                    if text_key in seen_text_keys:
                        continue
                    seen_text_keys.add(text_key)

                # Собираем объект новости
                news_item = {
                    "id": message.id,
                    "title": preview or "Media post",
                    "link": post_link,
                    "description": preview or "",
                    "pubDate": pub_date,
                    "author": entity.title,
                    "channel": entity.title
                }

                channel_items.append(news_item)
                processed_count += 1

                # Если нужно скачать картинку (опционально)
                # if message.photo:
                #    path = await message.download_media(file=f"./downloads/{message.id}")

            news_by_channel[str(channel)] = {
                "channel": str(channel),
                "channelTitle": entity.title,
                "items": channel_items
            }
                
        except Exception as e:
            print(f"❌ Ошибка с каналом {channel}: {e}")

    return news_by_channel

def _safe_filename(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", name.lstrip("@")) or "channel"

def _parse_date(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return datetime.min.replace(tzinfo=timezone.utc)

def _merge_items(existing_items, new_items):
    merged = {str(item.get("id")): item for item in existing_items if "id" in item}
    for item in new_items:
        merged[str(item["id"])] = item
    items = list(merged.values())
    items.sort(key=lambda item: _parse_date(item.get("pubDate", "")), reverse=True)
    return items

def _save_channel_json(channel_data, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    channel_key = channel_data["channel"]
    channel_title = channel_data["channelTitle"]
    file_path = output_dir / f"{_safe_filename(channel_key)}.json"

    existing_items = []
    if file_path.exists():
        try:
            existing_data = json.loads(file_path.read_text(encoding="utf-8"))
            existing_items = existing_data.get("items", [])
        except Exception:
            existing_items = []

    merged_items = _merge_items(existing_items, channel_data["items"])
    payload = {
        "feed": channel_key,
        "channel": channel_title,
        "items": merged_items,
        "count": len(merged_items),
        "scraped_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    }

    atomic_write_json(str(file_path), payload)

def _strip_markdown(text: str) -> str:
    # Remove basic markdown markers (bold/italic/code)
    text = text.replace("**", "").replace("__", "")
    text = text.replace("*", "").replace("_", "")
    text = text.replace("`", "")
    return text

def _build_preview(text: str, limit: int = 120) -> str:
    """
    Build preview where markdown links are shown as:
      label (url)
    but URL length does NOT count towards the limit.
    """
    parts = re.split(r"(\[([^\]]+)\]\((https?://[^)]+)\))", text)
    output = []
    visible_len = 0
    truncated = False

    for part in parts:
        if not part:
            continue

        link_match = re.match(r"\[([^\]]+)\]\((https?://[^)]+)\)", part)
        if link_match:
            label = _strip_markdown(link_match.group(1).strip())
            url = link_match.group(2).strip()
            if not label:
                continue
            if visible_len >= limit:
                truncated = True
                break
            remaining = limit - visible_len
            if len(label) > remaining:
                label = label[:remaining].rstrip()
                truncated = True
            output.append(label)
            output.append(f" ({url})")
            visible_len += len(label)
            if visible_len >= limit:
                truncated = True
                break
            continue

        chunk = _strip_markdown(part)
        if not chunk:
            continue
        if visible_len >= limit:
            truncated = True
            break
        remaining = limit - visible_len
        if len(chunk) > remaining:
            chunk = chunk[:remaining].rstrip()
            truncated = True
        output.append(chunk)
        visible_len += len(chunk)
        if visible_len >= limit:
            truncated = True
            break

    cleaned = "".join(output)
    cleaned = " ".join(cleaned.strip().split())
    if truncated:
        cleaned = cleaned.rstrip() + "..."
    return cleaned

# Запуск асинхронной функции
def main():
    # Конструкция 'with client' сама делает connect() и disconnect()
    with client:
        # При первом запуске скрипт спросит номер телефона и код в консоли!
        result = client.loop.run_until_complete(fetch_news())
        
        total_new = sum(len(data["items"]) for data in result.values())
        print(f"\n✅ Всего собрано новостей: {total_new}")
        
        # Вывод (или сохранение в базу)
        for channel_key, data in result.items():
            for item in data["items"]:
                print(f"[{item['pubDate']}] {item['channel']}")
                print(f"🔗 {item['link']}")
                print("-" * 20)
            _save_channel_json(data, Path("data") / "tg")

if __name__ == '__main__':
    main()
