"""Command-line entry point for the observation-only worker."""
import argparse
import logging
import signal
import sys

from .worker import build_worker_from_environment


def main(argv=None):
    parser = argparse.ArgumentParser(description="Run the PAPER observation-only trading worker.")
    parser.add_argument("--once", action="store_true", help="run one observation cycle and exit")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    logger = logging.getLogger("small-trading-worker")
    store = None
    worker = None
    try:
        worker, store = build_worker_from_environment()
        if args.once:
            reports = worker.run_once()
            failed = sum(report is None for report in reports)
            logger.info("one-shot cycle complete: symbols=%d failed=%d", len(reports), failed)
            return 1 if failed else 0

        def request_shutdown(signum, _frame):
            logger.info("shutdown requested (signal %s)", signum)
            worker.scheduler.stop()

        signal.signal(signal.SIGINT, request_shutdown)
        signal.signal(signal.SIGTERM, request_shutdown)
        logger.info(
            "starting observation-only worker: symbols=%s interval_seconds=%d execution_enabled=false",
            ",".join(worker.symbols),
            worker.interval_seconds,
        )
        worker.run_forever()
        logger.info("worker stopped cleanly")
        return 0
    except Exception:
        logger.exception("worker startup or runtime failed")
        return 1
    finally:
        if store is not None:
            store.close()


if __name__ == "__main__":
    sys.exit(main())
