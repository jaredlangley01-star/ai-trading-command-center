import json
from threading import Thread
from urllib.request import urlopen
from urllib.error import HTTPError
from trading_engine.api_runtime import build_dashboard_server_from_environment

def test_api_runtime_starts_read_only_without_broker_credentials(tmp_path, monkeypatch):
    monkeypatch.setenv("SMALL_TRADING_DATABASE_PATH", str(tmp_path / "api.db"))
    monkeypatch.setenv("SMALL_TRADING_API_HOST", "127.0.0.1")
    monkeypatch.setenv("SMALL_TRADING_API_PORT", "0")
    monkeypatch.delenv("APCA_API_KEY_ID", raising=False)
    monkeypatch.delenv("APCA_API_SECRET_KEY", raising=False)
    monkeypatch.delenv("SMALL_TRADING_API_TOKEN", raising=False)
    server, store = build_dashboard_server_from_environment()
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        assert server.server_address[0] == "127.0.0.1"
        try:
            urlopen(f"http://127.0.0.1:{server.server_address[1]}/api/broker")
            assert False, "broker must remain disconnected without credentials"
        except HTTPError as error:
            assert error.code == 503
            assert json.loads(error.read())["mode"] == "NOT_CONNECTED"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        store.close()
