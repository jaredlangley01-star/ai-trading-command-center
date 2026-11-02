from trading_engine.app_runtime import configure_api_environment


def test_combined_app_binds_to_platform_port_and_public_interface(monkeypatch):
    monkeypatch.delenv("SMALL_TRADING_API_HOST", raising=False)
    monkeypatch.delenv("SMALL_TRADING_API_PORT", raising=False)
    monkeypatch.setenv("PORT", "10000")

    configure_api_environment()

    import os
    assert os.environ["SMALL_TRADING_API_HOST"] == "0.0.0.0"
    assert os.environ["SMALL_TRADING_API_PORT"] == "10000"


def test_combined_app_preserves_explicit_api_configuration(monkeypatch):
    monkeypatch.setenv("SMALL_TRADING_API_HOST", "127.0.0.1")
    monkeypatch.setenv("SMALL_TRADING_API_PORT", "8765")
    monkeypatch.setenv("PORT", "10000")

    configure_api_environment()

    import os
    assert os.environ["SMALL_TRADING_API_HOST"] == "127.0.0.1"
    assert os.environ["SMALL_TRADING_API_PORT"] == "8765"
