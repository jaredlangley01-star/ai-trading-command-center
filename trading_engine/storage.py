"""SQLite event/audit store for the initial single-worker deployment."""
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock

class SQLiteStore:
    def __init__(self, path: str = "data/trading.db"):
        self.path = path
        self._lock = RLock()
        self._keeper = None
        if path == ":memory:":
            self._dsn = "file:smalltrading-memory?mode=memory&cache=shared"
            self._uri = True
            self._keeper = sqlite3.connect(self._dsn, uri=True, check_same_thread=False)
        else:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            self._dsn, self._uri = path, False
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
        db = sqlite3.connect(self._dsn, timeout=10, uri=self._uri, check_same_thread=False)
        db.row_factory = sqlite3.Row
        return db

    def append_event(self, event_type: str, payload: dict, event_key: str | None = None) -> bool:
        encoded = json.dumps(payload, sort_keys=True, default=str)
        now = datetime.now(timezone.utc).isoformat()
        with self._lock, self._connect() as db:
            try:
                db.execute("INSERT INTO events(event_type,event_key,payload,created_at) VALUES(?,?,?,?)",
                           (event_type,event_key,encoded,now))
                return True
            except sqlite3.IntegrityError:
                if event_key is not None: return False
                raise

    def get_event_by_key(self, event_key: str):
        with self._lock, self._connect() as db:
            row=db.execute("SELECT id,event_type,event_key,payload,created_at FROM events WHERE event_key=?",(event_key,)).fetchone()
        if row is None: return None
        result=dict(row)
        result["payload"]=json.loads(result["payload"])
        return result

    def list_events(self, limit: int = 100) -> list[dict]:
        if limit < 1: raise ValueError("limit must be positive")
        with self._lock, self._connect() as db:
            rows=db.execute("SELECT id,event_type,event_key,payload,created_at FROM events ORDER BY id DESC LIMIT ?",(limit,)).fetchall()
        return [{**dict(row),"payload":json.loads(row["payload"])} for row in rows]

    def close(self):
        if self._keeper is not None:
            self._keeper.close()
            self._keeper = None
