"""Combined single-service runtime for hosts with one persistent disk.

Runs the observation worker and read-only dashboard API in one container so
both can safely use the same SQLite database file on a single-instance host.
"""
import logging
import os
import signal
from threading import Event, Thread

from .api_runtime import build_dashboard_server_from_environment
from .worker import build_worker_from_environment


def configure_api_environment():
    """Bind the API to the host's public web port while retaining token auth."""
    os.environ.setdefault("SMALL_TRADING_API_HOST", "0.0.0.0")
    if os.getenv("PORT") and not os.getenv("SMALL_TRADING_API_PORT"):
        os.environ["SMALL_TRADING_API_PORT"] = os.environ["PORT"]


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    api_server = None
    api_store = None
    worker_store = None
    worker = None
    api_thread = None
    worker_thread = None
    stopped = Event()
    try:
        # Both processes open the same configured SQLite path. This is safe
        # here because they run on one host and one persistent disk.
        worker, worker_store = build_worker_from_environment()
        configure_api_environment()
        api_server, api_store = build_dashboard_server_from_environment()

        def request_shutdown(signum, _frame):
            logging.info("combined app shutdown requested (signal %s)", signum)
            stopped.set()
            worker.scheduler.stop()

        signal.signal(signal.SIGINT, request_shutdown)
        signal.signal(signal.SIGTERM, request_shutdown)

        api_thread = Thread(target=api_server.serve_forever, name="dashboard-api", daemon=True)
        worker_thread = Thread(target=worker.run_forever, name="observation-worker", daemon=True)
        api_thread.start()
        worker_thread.start()
        logging.info(
            "combined PAPER observation app started: api=%s:%s symbols=%s interval_seconds=%d execution_enabled=false",
            *api_server.server_address[:2],
            ",".join(worker.symbols),
            worker.interval_seconds,
        )

        while not stopped.wait(1):
            if not api_thread.is_alive():
                raise RuntimeError("DASHBOARD_API_SERVER_STOPPED")
            if not worker_thread.is_alive():
                raise RuntimeError("OBSERVATION_WORKER_STOPPED")

        worker.scheduler.stop()
        api_server.shutdown()
        api_thread.join(timeout=10)
        worker_thread.join(timeout=10)
        if api_thread.is_alive() or worker_thread.is_alive():
            raise RuntimeError("APP_SHUTDOWN_TIMEOUT")
        logging.info("combined app stopped cleanly")
        return 0
    except Exception:
        logging.exception("combined app startup or runtime failed")
        return 1
    finally:
        if worker is not None:
            worker.scheduler.stop()
        if api_server is not None:
            api_server.server_close()
        if api_store is not None:
            api_store.close()
        if worker_store is not None:
            worker_store.close()


if __name__ == "__main__":
    raise SystemExit(main())
