"""Heartbeat events and read-only process health reporting."""
from datetime import datetime, timezone


class Heartbeat:
    def __init__(self, store, component="trading-engine"):
        self.store, self.component = store, component

    def record(self, status="OK", message=""):
        if status not in {"OK", "DEGRADED", "ERROR"}:
            raise ValueError("INVALID_HEALTH_STATUS")
        now = datetime.now(timezone.utc).isoformat()
        self.store.append_event(
            "HEARTBEAT",
            {"component": self.component, "status": status, "message": message, "timestamp": now},
        )
        return {"component": self.component, "status": status, "timestamp": now}


class HealthSnapshot:
    def __init__(self, store, stale_after_seconds=120):
        self.store, self.stale_after_seconds = store, stale_after_seconds

    def build(self, now=None):
        now = now or datetime.now(timezone.utc)
        latest = next(
            (e for e in self.store.list_events(1000) if e["event_type"] == "HEARTBEAT"),
            None,
        )
        if latest is None:
            return {"status": "UNKNOWN", "heartbeat_at": None, "message": "No heartbeat recorded"}
        payload = latest["payload"]
        timestamp = datetime.fromisoformat(payload["timestamp"])
        age = max(0.0, (now - timestamp).total_seconds())
        status = payload["status"] if age <= self.stale_after_seconds else "STALE"
        return {
            "status": status,
            "component": payload["component"],
            "heartbeat_at": payload["timestamp"],
            "age_seconds": round(age, 2),
            "message": payload.get("message", ""),
        }
