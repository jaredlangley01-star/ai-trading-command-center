"""SQLite event/audit store for the initial single-worker deployment."""
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock

class SQLiteStore:
    def __init__(self, path: str = "data/trading.db"):
        self.path = path
        if path != ":memory:": Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        with self._connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                event_key TEXT,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL
            )""")
            db.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_event_key ON events(event_key) WHERE event_key IS NOT NULL")

    def _connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    def append_event(self, event_type: str, payload: dict, event_key: str | None = None) -> bool:
        """Returns False for a duplicate idempotency key; otherwise persists event."""
        encoded = json.dumps(payload, sort_keys=True, default=str)
        now = datetime.now(timezone.utc).isoformat()
        with self._lock, self._connect() as db:
            try:
                db.execute("INSERT INTO events(event_type,event_key,payload,created_at) VALUES(?,?,?,?)",
                           (event_type,event_key,encoded,now))
                return True
            except sqlite3.IntegrityError:
                if event_key is not None:
                    return False
                raise

    def list_events(self, limit: int = 100) -> list[dict]:
        if limit < 1: raise ValueError("limit must be positive")
        with self._connect() as db:
            rows=db.execute("SELECT id,event_type,event_key,payload,created_at FROM events ORDER BY id DESC LIMIT ?",(limit,)).fetchall()
        return [{**dict(row),"payload":json.loads(row["payload"])} for row in rows]
