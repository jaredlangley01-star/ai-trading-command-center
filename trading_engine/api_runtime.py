"""Standalone read-only dashboard API process."""
import logging
import os
import signal
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
    try:
        broker_reader = AlpacaPaperAccountReader()
    except AlpacaPaperAccountError:
        pass
    server = create_dashboard_server(
        portfolio, health,
        broker_snapshot=broker_reader,
        host=host, port=port, access_token=token,
    )
    return server, store


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    server = None
    store = None
    try:
        server, store = build_dashboard_server_from_environment()
        logging.info("read-only dashboard API listening on %s:%s", *server.server_address)
        def stop(_signum, _frame):
            server.shutdown()
        signal.signal(signal.SIGINT, stop)
        signal.signal(signal.SIGTERM, stop)
        server.serve_forever()
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
