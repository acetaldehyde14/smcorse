import json
import os

# Store config in %APPDATA%\iRacingEnduro on Windows
_APPDATA = os.environ.get("APPDATA", os.path.expanduser("~"))
CONFIG_DIR = os.path.join(_APPDATA, "iRacingEnduro")
CONFIG_PATH = os.path.join(CONFIG_DIR, "config.json")

DEFAULT_SERVER_URL = "https://smcorse.com"

POLL_INTERVAL_SECONDS = 2       # how often to read iRacing data
LOW_FUEL_THRESHOLD_MINS = 20    # minutes of fuel left before alert


def load_config() -> dict:
    if not os.path.exists(CONFIG_PATH):
        return {}
    try:
        with open(CONFIG_PATH, "r") as f:
            return json.load(f)
    except Exception:
        return {}


def save_config(data: dict):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        json.dump(data, f, indent=2)


def clear_config():
    if os.path.exists(CONFIG_PATH):
        os.remove(CONFIG_PATH)


def get_server_url() -> str:
    """Return the configured server URL, falling back to the default."""
    cfg = load_config()
    return cfg.get("server_url", DEFAULT_SERVER_URL).rstrip("/")
