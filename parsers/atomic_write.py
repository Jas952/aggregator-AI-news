import json
import os
import time
import random
from pathlib import Path
from typing import Any, Dict


def atomic_write_json(file_path: str, data: Any, indent: int = 2) -> bool:
    """
    Atomically write data to a JSON file

    Args:
        file_path: Target file path
        data: Data to write (will be JSON serialized)
        indent: JSON indentation (default: 2)

    Returns:
        bool: Success status
    """
    try:
        # Create directory if it doesn't exist
        file_path_obj = Path(file_path)
        file_path_obj.parent.mkdir(parents=True, exist_ok=True)

        # Generate unique temporary file name
        timestamp = int(time.time() * 1000)
        random_suffix = ''.join(random.choices('abcdefghijklmnopqrstuvwxyz0123456789', k=6))
        temp_file = f"{file_path}.tmp.{timestamp}.{random_suffix}"

        # Step 1: Write to temporary file
        with open(temp_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=indent, ensure_ascii=False)

        # Step 2: Atomically rename (this is the atomic operation!)
        # os.replace() is atomic on both POSIX and Windows
        os.replace(temp_file, file_path)

        return True

    except Exception as error:
        print(f"[Atomic Write] Failed to write {file_path}: {error}")

        # Cleanup: try to remove temp file if it exists
        try:
            if 'temp_file' in locals() and os.path.exists(temp_file):
                os.remove(temp_file)
        except:
            pass  # Ignore cleanup errors

        return False


def atomic_write_file(file_path: str, content: str) -> bool:
    """
    Atomically write raw text to a file

    Args:
        file_path: Target file path
        content: Content to write

    Returns:
        bool: Success status
    """
    try:
        file_path_obj = Path(file_path)
        file_path_obj.parent.mkdir(parents=True, exist_ok=True)

        timestamp = int(time.time() * 1000)
        random_suffix = ''.join(random.choices('abcdefghijklmnopqrstuvwxyz0123456789', k=6))
        temp_file = f"{file_path}.tmp.{timestamp}.{random_suffix}"

        with open(temp_file, 'w', encoding='utf-8') as f:
            f.write(content)

        os.replace(temp_file, file_path)

        return True

    except Exception as error:
        print(f"[Atomic Write] Failed to write {file_path}: {error}")
        return False


# Backward compatibility wrapper
def save_json_atomic(file_path: str, data: Dict) -> None:
    """Legacy function for backward compatibility"""
    atomic_write_json(file_path, data)
