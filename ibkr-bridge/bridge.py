"""Windows entry point for the loopback-only IBKR PAPER bridge."""

from __future__ import annotations

import sys

try:
    from ibkr_client import IBKRClient
except ModuleNotFoundError as error:
    if error.name == "ibapi":
        print("Official IBKR TWS Python API is not installed in this environment.")
        print("Follow OWNER_SETUP_TRADE-008.1.md; do not install an unofficial PyPI build.")
        raise SystemExit(2) from error
    raise

from http_server import BridgeHTTPServer
from safety import HTTP_HOST, HTTP_PORT, IBKR_CLIENT_ID, IBKR_HOST, IBKR_PORT


def main() -> int:
    client = IBKRClient()
    try:
        client.start()
        print(f"Connected to IB Gateway PAPER at {IBKR_HOST}:{IBKR_PORT} with client ID {IBKR_CLIENT_ID}.")
    except Exception as error:
        print(f"IB Gateway PAPER is not connected yet: {error}")
        print("The HTTP bridge will remain available and retry on requests.")
    server = BridgeHTTPServer((HTTP_HOST, HTTP_PORT), client)

    print(f"IBKR PAPER bridge listening only on http://{HTTP_HOST}:{HTTP_PORT}")
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        print("Stopping IBKR PAPER bridge.")
    finally:
        server.server_close()
        client.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
