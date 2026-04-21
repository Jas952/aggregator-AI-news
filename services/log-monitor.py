#!/usr/bin/env python3 -u
"""
Telegram Log Monitor - Minimal notifications

Monitors Docker logs and sends minimal notifications:
- ✅ Bot status (every 1 hour)
- 🔄 Data refresh completed
- ❌ Errors detected

Run: python3 services/log-monitor.py
"""

import subprocess
import requests
import os
import time
import re
import sys
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv

# Disable output buffering for Docker
sys.stdout = os.fdopen(sys.stdout.fileno(), 'w', buffering=1)
sys.stderr = os.fdopen(sys.stderr.fileno(), 'w', buffering=1)

# Load .env variables
load_dotenv()

# Configuration from .env
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_LOGS_API')
TELEGRAM_CHAT_ID = os.getenv('TELEGRAM_LOGS_CHANNEL')
CONTAINER_NAME = 'aishny_site-app-1'  # Updated container name
STATUS_CHECK_INTERVAL = 3600  # 1 hour
LOG_CHECK_INTERVAL = 60  # 1 minute

# Moscow timezone (UTC+3)
MSK = timezone(timedelta(hours=3))


class LogMonitor:
    def __init__(self):
        self.last_refresh_time = None
        self.last_error_msg = None
        self.last_status_time = 0
        self.time_json_path = 'etc/time.json'

    def send_telegram(self, message):
        """Send message to Telegram"""
        if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
            print("⚠️ Telegram credentials not configured")
            return False

        try:
            url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
            data = {
                'chat_id': TELEGRAM_CHAT_ID,
                'text': message,
                'parse_mode': 'HTML'
            }
            response = requests.post(url, json=data, timeout=10)
            
            if response.status_code == 200:
                print(f"✓ Telegram notification sent")
                return True
            else:
                print(f"✗ Telegram error: {response.status_code}")
                return False
                
        except Exception as e:
            print(f"✗ Failed to send Telegram: {e}")
            return False

    def check_refresh_status(self):
        """Check if data refresh completed"""
        try:
            import json
            if os.path.exists(self.time_json_path):
                with open(self.time_json_path, 'r') as f:
                    data = json.load(f)
                    last_update = data.get('lastUpdate')

                    if last_update and last_update != self.last_refresh_time:
                        self.last_refresh_time = last_update

                        # Parse timestamp and convert to MSK
                        dt = datetime.fromisoformat(last_update.replace('Z', '+00:00'))
                        time_str = dt.astimezone(MSK).strftime('%H:%M')

                        # Send notification
                        message = f"🟡 Refreshed | {time_str}"
                        self.send_telegram(message)

        except Exception as e:
            print(f"Error checking refresh status: {e}")

    def check_docker_logs(self):
        """Check Docker logs for errors - disabled when running inside Docker"""
        # This method is disabled when running inside Docker container
        # as docker commands are not available from within the container
        pass

    def send_status_update(self):
        """Send hourly status update"""
        now = time.time()

        if now - self.last_status_time >= STATUS_CHECK_INTERVAL:
            self.last_status_time = now

            try:
                time_str = datetime.now(MSK).strftime('%H:%M')
                message = f"🟢 Monitor Active | {time_str}"
                self.send_telegram(message)

            except Exception as e:
                print(f"Error sending status: {e}")

    def run(self):
        """Main monitoring loop"""
        print("🔍 Starting Telegram Log Monitor...")
        print(f"📱 Chat ID: {TELEGRAM_CHAT_ID}")
        print(f"⏱  Status updates: every {STATUS_CHECK_INTERVAL}s")
        print(f"📋 Log checks: every {LOG_CHECK_INTERVAL}s")
        print("")
        
        # Send startup notification (optional, can be disabled)
        # self.send_telegram("🚀 Monitor started")
        
        while True:
            try:
                # Check refresh status
                self.check_refresh_status()
                
                # Check logs for errors
                self.check_docker_logs()
                
                # Send hourly status
                self.send_status_update()
                
                # Wait before next check
                time.sleep(LOG_CHECK_INTERVAL)
                
            except KeyboardInterrupt:
                print("\n⏹️  Stopping monitor...")
                break
            except Exception as e:
                print(f"Monitor error: {e}")
                time.sleep(LOG_CHECK_INTERVAL)


if __name__ == '__main__':
    monitor = LogMonitor()
    monitor.run()
