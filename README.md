# Aishny Site

An AI news aggregator and showcase site that collects content from multiple source types:

- RSS feeds
- HTML pages without RSS
- JavaScript-heavy websites via Selenium
- Telegram channels
- Midjourney Explore

The project combines a website, an API layer, background refresh jobs, and dedicated parsers.

![Project Demo](./assets/aishniy.gif)

## Overview

The system runs a local website and API, collects content from different sources, stores the results in JSON files, and renders them in a web interface.

Main content blocks:

- AI and tech news from RSS feeds
- aggregated sources such as Hugging Face and Lobsters
- Telegram channel updates
- a Midjourney gallery
- scheduled data refresh
- local monitoring and Telegram notifications

## Stack

- Node.js
- Python 3
- Selenium / Chromium
- Docker Compose
- Cloudflare Tunnel for public exposure

## Project Structure

```text
aishny_site/
├── assets/                  # static assets and demo media
├── config/                  # source lists and Telegram channel config
├── data/                    # generated JSON data and user suggestions
├── dev/                     # development scripts and dev compose setup
├── etc/                     # runtime files, time.json, Telegram session files
├── parsers/                 # Telegram / Selenium / Midjourney parsers
├── services/                # website, RSS API, auto-refresh, monitoring
├── tools/                   # test and diagnostics shell scripts
├── Dockerfile
├── docker-compose.yml
├── package.json
└── requirements.txt
```

Key files:

- `services/server.js` — main website and API gateway
- `services/rss-server.js` — standalone RSS/API backend
- `services/auto-refresh.js` — scheduled refresh service
- `services/log-monitor.py` — monitoring and Telegram notifications
- `parsers/parsing_telegram.py` — Telegram post collection
- `parsers/web-scraper-selenium.py` — Selenium-based scraper for dynamic sites
- `parsers/midjourney-scraper.js` — Midjourney gallery refresh

## API Endpoints

Main site API:

- `GET /api/news/telegram`
- `GET /api/news/rss`
- `GET /api/news/aggregator`
- `GET /api/news/midjourney-data`
- `GET /api/cache/stats`
- `POST /api/cache/clear`
- `POST /api/suggest-source`
- `GET /api/refresh`

RSS backend:

- `GET /api/rss/all`
- `GET /api/rss/<feed_name>`

## Data Storage

The project stores local generated data in:

- `data/tg/` — Telegram JSON snapshots
- `data/my-source-jsons/` — RSS and scraper outputs
- `data/news-aggregator-jsons/` — aggregated source outputs
- `data/midjourney/` — Midjourney JSON and locally saved thumbnails
- `data/user-suggestions/` — user-submitted suggestions
- `etc/time.json` — last refresh metadata

These files are runtime artifacts, not necessarily the source code part of the project.

## Environment Variables

A template is provided in `.env.example`.

Important variables:

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `MJ_AUTH_TOKEN`
- `CF_CLEARANCE`
- `REFRESH_INTERVAL_HOURS`

Optional notification variables:

- `TELEGRAM_NOTIFIER_BOT_TOKEN`
- `TELEGRAM_NOTIFIER_CHAT_ID`
- `TELEGRAM_LOGS_API`
- `TELEGRAM_LOGS_CHANNEL`

## Quick Start with Docker

Recommended startup method:

```bash
docker compose up -d --build
```

After startup:

- website: `http://localhost:8000`
- RSS/API backend: `http://localhost:8001`
- Selenium: `http://localhost:4444`

Basic check:

```bash
curl http://localhost:8000/
curl http://localhost:8001/api/rss/all
```

## Local Start Without Docker

Install dependencies:

```bash
npm install
pip3 install -r requirements.txt
```

Start all services:

```bash
npm run dev
```

This starts:

- the website
- the RSS backend
- auto-refresh
- log monitor

Individual commands:

```bash
npm run site
npm run rss
npm run refresh
npm run refresh:now
npm run monitor
npm run parse:telegram
npm run parse:midjourney
```

## Development Mode

The project includes a separate development workflow via `dev/dev.sh`.

Useful commands:

```bash
./dev/dev.sh start
./dev/dev.sh logs
./dev/dev.sh status
./dev/dev.sh shell
```

Development endpoints:

- `http://localhost:8002`
- `http://localhost:8003`

## Testing and Diagnostics

There are helper scripts for quick validation:

```bash
./tools/test-full.sh
./tools/test-api-gateway.sh
```

They check:

- Docker containers
- port availability
- API endpoints
- data presence
- Selenium readiness
- basic runtime settings

## Cloudflare Tunnel

The project can be exposed publicly through Cloudflare Tunnel.

Typical command:

```bash
cloudflared tunnel --protocol http2 run <TUNNEL_ID>
```

When using a named tunnel, make sure that:

- the hostname points to the correct tunnel
- the origin points to `http://localhost:8000`
- the tunnel runs on the same machine where the local app is actually up

## Public Repository Notes

This repository should not include:

- `.env`
- Telegram session files from `etc/`
- Cloudflare credentials
- cookies or Midjourney auth state
- generated data from `data/`
- logs and runtime artifacts
- private source/channel lists

The public-safe part of the project is mainly:

- code in `services/`, `parsers/`, `config/`, `tools/`
- `Dockerfile`, `docker-compose.yml`, `package.json`, `requirements.txt`
- `.env.example`
- documentation and media that do not contain secrets

## Important Notes

- Midjourney CDN may block direct image loading; the project can rely on locally saved thumbnails.
- Some sources may occasionally return `403`, challenge pages, or malformed XML.
- Telegram and Midjourney integrations depend on valid credentials in `.env`.
- Selenium sources are sensitive to startup order and the availability of `selenium:4444`.

## Partial Public Snapshot

This repository does not include a significant part of the larger internal codebase and related work.
If you want a fuller walkthrough or a demo of the closed parts, please contact me directly:

- Telegram: `@Jas952`
- LinkedIn: <https://www.linkedin.com/in/jas952/>

