import requests
import threading
from config import load_config, get_server_url

_lock = threading.Lock()
_failed_events = []   # queue events that failed to send for retry


def _get_headers() -> dict:
    cfg = load_config()
    token = cfg.get("token", "")
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def login(username: str, password: str, server_url: str | None = None) -> dict:
    """Returns { token, user } or raises an exception."""
    url = (server_url or get_server_url()).rstrip("/")
    r = requests.post(
        f"{url}/api/auth/login",
        json={"username": username, "password": password},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def validate_token() -> bool:
    """Returns True if the stored token is still valid."""
    try:
        r = requests.post(
            f"{get_server_url()}/api/auth/validate",
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
            f"{get_server_url()}/api/iracing/event",
            json={"event": event_type, "data": data},
            headers=_get_headers(),
            timeout=5,
        )
        return r.status_code == 200
    except Exception as e:
        print(f"[API] Failed to send {event_type}: {e}")
        return False


def register() -> dict | None:
    """Register this client session with the server. Returns { ok, user, active_race } or None."""
    try:
        r = requests.post(
            f"{get_server_url()}/api/client/register",
            headers=_get_headers(),
            timeout=5,
        )
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        print(f"[API] Register failed: {e}")
    return None


def post_telemetry(lap: int | None, samples: list) -> bool:
    """Post a compressed telemetry batch to the server."""
    import gzip, json as _json
    try:
        payload = _json.dumps({"lap": lap, "samples": samples}).encode("utf-8")
        compressed = gzip.compress(payload)
        r = requests.post(
            f"{get_server_url()}/api/iracing/telemetry",
            data=compressed,
            headers={**_get_headers(), "Content-Encoding": "gzip", "Content-Type": "application/json"},
            timeout=5,
        )
        return r.status_code == 200
    except Exception as e:
        print(f"[API] Failed to send telemetry: {e}")
        return False


def get_status() -> dict | None:
    """Fetch current race status from server."""
    try:
        r = requests.get(
            f"{get_server_url()}/api/iracing/status",
            headers=_get_headers(),
            timeout=5,
        )
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return None
