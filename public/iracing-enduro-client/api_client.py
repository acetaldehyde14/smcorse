import requests
import threading
from config import load_config, SERVER_URL

_lock = threading.Lock()
_failed_events = []   # queue events that failed to send for retry


def _get_headers() -> dict:
    cfg = load_config()
    token = cfg.get("token", "")
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def login(username: str, password: str) -> dict:
    """Returns { token, user } or raises an exception."""
    r = requests.post(
        f"{SERVER_URL}/api/auth/login",
        json={"username": username, "password": password},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def validate_token() -> bool:
    """Returns True if the stored token is still valid."""
    try:
        r = requests.post(
            f"{SERVER_URL}/api/auth/validate",
            headers=_get_headers(),
            timeout=5,
        )
        return r.status_code == 200
    except Exception:
        return False


def post_event(event_type: str, data: dict) -> bool:
    """Post a telemetry event to the server. Returns True on success."""
    try:
        r = requests.post(
            f"{SERVER_URL}/api/iracing/event",
            json={"event": event_type, "data": data},
            headers=_get_headers(),
            timeout=5,
        )
        return r.status_code == 200
    except Exception as e:
        print(f"[API] Failed to send {event_type}: {e}")
        return False


def get_status() -> dict | None:
    """Fetch current race status from server."""
    try:
        r = requests.get(
            f"{SERVER_URL}/api/iracing/status",
            headers=_get_headers(),
            timeout=5,
        )
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return None
