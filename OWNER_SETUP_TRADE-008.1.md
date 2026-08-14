# OWNER SETUP — TRADE-008.1

1. Install a current supported Python 3 release for Windows and confirm `py --version` works in PowerShell.
2. Download and install the current **official TWS API for Windows** from the [Interactive Brokers TWS API documentation](https://www.interactivebrokers.com/campus/ibkr-api-page/twsapi-doc/). Use only its official MSI/ZIP download; do not install an `ibapi` package from PyPI.
3. Keep the official TWS API version aligned with the installed Stable or Latest IB Gateway version.
4. Open PowerShell in the Trading Command Center project and create the bridge environment:

   ```powershell
   py -m venv .\ibkr-bridge\.venv
   ```

5. Install the official local Python client into that environment. If the MSI used its default location:

   ```powershell
   .\ibkr-bridge\.venv\Scripts\python.exe -m pip install "C:\TWS API\source\pythonclient"
   ```

6. Verify the package came from the locally installed official source:

   ```powershell
   .\ibkr-bridge\.venv\Scripts\python.exe -m pip show ibapi
   ```

7. Install and open the current Stable or Latest **IB Gateway**. Sign in with the IBKR **PAPER** account only.
8. In IB Gateway API settings:
   - Enable ActiveX and Socket Clients.
   - Set Socket Port to `4002`.
   - Allow connections from localhost/trusted IP `127.0.0.1` only.
   - Disable Read-Only API only when PAPER order submission is intended.
   - Never use live port `4001` or `7496`.
9. Confirm the application `.env.local` contains:
   - `IBKR_ADAPTER=TWS`
   - `IBKR_ENVIRONMENT=PAPER`
   - `IBKR_TWS_BRIDGE_URL=http://127.0.0.1:8765`
   - `IBKR_TWS_HOST=127.0.0.1`
   - `IBKR_TWS_PORT=4002`
   - `IBKR_TWS_CLIENT_ID=41`
10. Start the bridge from the project directory:

    ```powershell
    .\ibkr-bridge\start-bridge.ps1
    ```

11. Open `http://127.0.0.1:8765/health` locally and confirm it reports `PAPER`.
12. Keep the PAPER IB Gateway session and bridge PowerShell window running while using IBKR PAPER data or orders. Reauthenticate directly in IB Gateway when required. Never place IBKR credentials in this project, Supabase, environment variables, or the bridge.
