# Alpaca Paper account reader

The AlpacaPaperAccountReader is a read-only integration for a user's Alpaca Paper account.

- Fixed API host: https://paper-api.alpaca.markets
- Read-only operations: account, positions, and recent orders (HTTP GET only)
- Credentials are read from APCA_API_KEY_ID and APCA_API_SECRET_KEY
- Returned account data is allow-listed; unknown broker fields are not forwarded.
- There are deliberately no order submission, replacement, cancellation, or position-closing methods.

This adapter is not yet wired into the dashboard or deployed. It requires Paper credentials in the eventual hosting environment. Never put credentials in source control or chat.

Paper account values are broker-reported simulated values, not live money or proof of strategy profitability.
