#!/usr/bin/env python3
"""
Web Scraper для JavaScript-сайтов (с использованием Selenium)

Этот скрейпер используется только для сайтов, которые:
- Загружают контент динамически через JavaScript
- Не предоставляют полноценный RSS фид
- Не работают с обычным requests + BeautifulSoup

Требования:
- selenium
- Chrome/Chromium браузер
- ChromeDriver

Использование:
    python3 parsers/web-scraper-selenium.py <site_name>

Поддерживаемые сайты перечислены в config/sources_list.txt
"""

import json
import sys
from datetime import datetime
from typing import List, Dict, Any, Optional
import time
import os
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from bs4 import BeautifulSoup


class SeleniumScraper:
    def __init__(self):
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
        self.root_dir = Path(__file__).resolve().parent.parent
        self.midjourney_images_dir = self.root_dir / 'data' / 'midjourney' / 'images'
        self.midjourney_images_dir.mkdir(parents=True, exist_ok=True)

    def _parse_date(self, value: str) -> Optional[datetime]:
        """Парсинг даты из различных форматов"""
        if not value:
            return None

        # Попытка парсинга разных форматов
        formats = [
            '%Y-%m-%d',
            '%b %d, %Y',
            '%B %d, %Y',
            '%Y-%m-%dT%H:%M:%S',
            '%Y-%m-%dT%H:%M:%SZ'
        ]

        for fmt in formats:
            try:
                return datetime.strptime(value, fmt)
            except:
                continue

        return None

    def _create_driver(self):
        """Создание headless Chrome драйвера"""
        chrome_options = Options()
        chrome_options.add_argument('--headless=new')
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')
        chrome_options.add_argument('--disable-gpu')
        chrome_options.add_argument('--window-size=1920,1080')
        chrome_options.add_argument(f'user-agent={self.headers["User-Agent"]}')

        remote_url = os.getenv('SELENIUM_REMOTE_URL')
        if not remote_url and os.path.exists('/.dockerenv'):
            remote_url = 'http://selenium:4444/wd/hub'

        if remote_url:
            return webdriver.Remote(command_executor=remote_url, options=chrome_options)

        return webdriver.Chrome(options=chrome_options)

    def _save_midjourney_thumbnail(self, element, job_id: str) -> Optional[str]:
        """Save a visible Midjourney tile locally so the site does not depend on CDN hotlinking."""
        file_path = self.midjourney_images_dir / f'{job_id}.png'
        try:
            if element.screenshot(str(file_path)):
                return f'/data/midjourney/images/{job_id}.png'
        except Exception as e:
            print(f"Error saving Midjourney thumbnail {job_id}: {e}", file=sys.stderr)
        return None

    def scrape_venturebeat_ai(self) -> List[Dict[str, Any]]:
        """
        Скрейпинг VentureBeat AI категории

        Проблема: VentureBeat загружает статьи через JavaScript,
        RSS фид дает только 1 статью вместо всех последних.
        """
        driver = None
        try:
            driver = self._create_driver()

            # Загрузка страницы
            url = 'https://venturebeat.com/category/ai'
            driver.get(url)

            # Ожидание загрузки контейнера
            wait = WebDriverWait(driver, 10)
            wait.until(EC.presence_of_element_located((By.ID, "vb-category-ai")))

            # Дополнительное ожидание для динамического контента
            time.sleep(3)

            # Получение HTML после выполнения JavaScript
            html = driver.page_source
            soup = BeautifulSoup(html, 'html.parser')

            articles = []
            seen_links = set()

            # Поиск контейнера со статьями
            container = soup.find(id='vb-category-ai') or soup

            # Парсинг статей
            for article in container.select('article'):
                try:
                    # Извлечение заголовка и ссылки
                    title_link = article.select_one('h2 a[href]') or article.find('a', href=True)
                    if not title_link:
                        continue

                    title = title_link.get_text(strip=True)
                    href = title_link.get('href', '')

                    if not title or not href:
                        continue

                    # Преобразование относительных ссылок
                    if not href.startswith('http'):
                        href = f"https://venturebeat.com{href}"

                    # Пропуск дубликатов
                    if href in seen_links:
                        continue
                    seen_links.add(href)

                    # Извлечение описания
                    excerpt_elem = article.select_one('.line-clamp-3 p') or article.select_one('.line-clamp-3')
                    description = excerpt_elem.get_text(strip=True) if excerpt_elem else ''

                    # Извлечение даты
                    time_elem = article.find('time')
                    pub_date = ''
                    if time_elem:
                        time_text = time_elem.get_text(" ", strip=True)
                        pub_date = time_text or time_elem.get('datetime', '')

                    articles.append({
                        'title': title,
                        'link': href,
                        'description': description,
                        'pubDate': pub_date,
                        'author': 'VentureBeat',
                        'categories': ['AI']
                    })

                except Exception as e:
                    print(f"Error parsing article: {e}", file=sys.stderr)
                    continue

            # Сортировка по дате
            articles.sort(
                key=lambda a: self._parse_date(a.get('pubDate', '')) or datetime.min,
                reverse=True
            )

            return articles

        except Exception as e:
            print(f"Error scraping VentureBeat AI: {e}", file=sys.stderr)
            return []

        finally:
            if driver:
                driver.quit()

    def scrape_midjourney_explore(self) -> List[Dict[str, Any]]:
        """Scrape Midjourney explore page"""
        driver = None
        try:
            driver = self._create_driver()
            driver.get('https://www.midjourney.com/explore?tab=top')
            wait = WebDriverWait(driver, 15)
            wait.until(EC.presence_of_all_elements_located((By.CSS_SELECTOR, 'a[href*="/jobs/"]')))
            time.sleep(3)  # Wait for images and layout to settle

            images = []
            seen_ids = set()
            image_links = driver.find_elements(By.CSS_SELECTOR, 'a[href*="/jobs/"]')

            for link in image_links[:50]:  # Limit to 50 images
                try:
                    job_href = link.get_attribute('href') or ''
                    if not job_href:
                        continue

                    job_id = job_href.split('/jobs/')[-1].split('?')[0]
                    if not job_id or job_id in seen_ids:
                        continue
                    seen_ids.add(job_id)

                    image_url = f'https://cdn.midjourney.com/{job_id}/0_0_384_N.webp'
                    image_url_high = f'https://cdn.midjourney.com/{job_id}/0_0_N.webp'
                    local_image_url = None

                    try:
                        image_element = link.find_element(By.CSS_SELECTOR, 'img')
                    except Exception:
                        image_element = link

                    local_image_url = self._save_midjourney_thumbnail(image_element, job_id)

                    images.append({
                        'id': job_id,
                        'imageUrl': local_image_url or image_url,
                        'imageUrlHigh': local_image_url or image_url_high,
                        'sourceImageUrl': image_url,
                        'sourceImageUrlHigh': image_url_high,
                        'link': job_href,
                        'author': 'Unknown',
                        'authorUrl': '',
                        'title': 'Midjourney Art',
                        'pubDate': datetime.utcnow().isoformat() + 'Z',
                        'categories': ['AI Art', 'Midjourney']
                    })

                except Exception as e:
                    print(f"Error parsing Midjourney image: {e}", file=sys.stderr)
                    continue

            return images

        except Exception as e:
            print(f"Error scraping Midjourney: {e}", file=sys.stderr)
            return []
        finally:
            if driver:
                driver.quit()

    def scrape_site(self, site_name: str) -> Dict[str, Any]:
        """Скрейпинг конкретного сайта по имени"""
        scrapers = {
            'venturebeat_ai': self.scrape_venturebeat_ai,
            'midjourney': self.scrape_midjourney_explore,
        }

        scraper_func = scrapers.get(site_name.lower())
        if not scraper_func:
            return {
                'error': f'Unknown site: {site_name}',
                'available': list(scrapers.keys())
            }

        items = scraper_func()

        return {
            'feed': site_name,
            'items': items,
            'count': len(items),
            'scraped_at': datetime.utcnow().isoformat() + 'Z',
            'method': 'selenium'
        }


def main():
    """
    CLI интерфейс
    Использование: python3 parsers/web-scraper-selenium.py <site_name>
    """
    if len(sys.argv) < 2:
        print(json.dumps({
            'error': 'Site name required',
            'usage': 'python3 parsers/web-scraper-selenium.py <site_name>',
            'available_sites': ['venturebeat_ai']
        }))
        sys.exit(1)

    site_name = sys.argv[1]
    scraper = SeleniumScraper()
    result = scraper.scrape_site(site_name)

    # Вывод JSON
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
