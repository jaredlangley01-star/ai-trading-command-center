"""Standalone read-only dashboard API process."""
import logging
import os
import signal
from threading import Event, Thread
from .alpaca_paper_account import AlpacaPaperAccountReader, AlpacaPaperAccountError
from .broker import SimulatedPaperBroker
from .dashboard_api import create_dashboard_server
from .health import HealthSnapshot
from .portfolio import PortfolioSnapshot
from .positions import PositionLedger
from .storage import SQLiteStore

def build_dashboard_server_from_environment():
    path = os.getenv("SMALL_TRADING_DATABASE_PATH", "data/trading.db")
    host = os.getenv("SMALL_TRADING_API_HOST", "127.0.0.1")
    port = int(os.getenv("SMALL_TRADING_API_PORT", "8765"))
    token = os.getenv("SMALL_TRADING_API_TOKEN")
    store = SQLiteStore(path)
    simulator = SimulatedPaperBroker()
    portfolio = PortfolioSnapshot(simulator, PositionLedger(store), store)
    health = HealthSnapshot(store)
    broker_reader = None
    api_key = os.getenv("APCA_API_KEY_ID", "")
    api_secret = os.getenv("APCA_API_SECRET_KEY", "")
    credentials_configured = (
        bool(api_key and api_secret)
        and not api_key.startswith("replace-with-")
        and not api_secret.startswith("replace-with-")
    )
    if credentials_configured:
        try:
            broker_reader = AlpacaPaperAccountReader()
        except AlpacaPaperAccountError:
            pass
    server = create_dashboard_server(portfolio, health, broker_snapshot=broker_reader, host=host, port=port, access_token=token, event_store=store, market_clock_snapshot=broker_reader)
    return server, store

def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    server = None
    store = None
    serving_thread = None
    stopped = Event()
    try:
        server, store = build_dashboard_server_from_environment()
        logging.info("read-only dashboard API listening on %s:%s", *server.server_address)
        serving_thread = Thread(target=server.serve_forever, name="dashboard-api", daemon=True)
        serving_thread.start()
        def stop(_signum, _frame):
            stopped.set()
        signal.signal(signal.SIGINT, stop)
        signal.signal(signal.SIGTERM, stop)
        while not stopped.wait(1):
            if not serving_thread.is_alive():
                raise RuntimeError("DASHBOARD_API_SERVER_STOPPED")
        server.shutdown()
        serving_thread.join(timeout=5)
        return 0
    except Exception:
        logging.exception("dashboard API startup failed")
        return 1
    finally:
        if server is not None:
            server.server_close()
        if store is not None:
            store.close()

if __name__ == "__main__":
    raise SystemExit(main())
