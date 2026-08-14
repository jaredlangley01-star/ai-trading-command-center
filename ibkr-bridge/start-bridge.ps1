$ErrorActionPreference = "Stop"
$bridgeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvPython = Join-Path $bridgeRoot ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $venvPython)) {
    throw "Bridge environment not found. Follow OWNER_SETUP_TRADE-008.1.md first."
}

Set-Location -LiteralPath $bridgeRoot
& $venvPython "bridge.py"
exit $LASTEXITCODE
