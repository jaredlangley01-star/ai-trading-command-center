from trading_engine import runtime


class FakeScheduler:
    def __init__(self):
        self.stopped = False
    def stop(self):
        self.stopped = True


class FakeWorker:
    symbols = ("AAPL", "MSFT")
    interval_seconds = 60
    def __init__(self):
        self.scheduler = FakeScheduler()
        self.ran_forever = False
    def run_once(self):
        return [object(), object()]
    def run_forever(self):
        self.ran_forever = True


class FakeStore:
    def __init__(self):
        self.closed = False
    def close(self):
        self.closed = True


def test_runtime_one_shot_closes_store(monkeypatch):
    worker, store = FakeWorker(), FakeStore()
    monkeypatch.setattr(runtime, "build_worker_from_environment", lambda: (worker, store))
    assert runtime.main(["--once"]) == 0
    assert store.closed


def test_runtime_one_shot_reports_failure(monkeypatch):
    worker, store = FakeWorker(), FakeStore()
    worker.run_once = lambda: [None, object()]
    monkeypatch.setattr(runtime, "build_worker_from_environment", lambda: (worker, store))
    assert runtime.main(["--once"]) == 1
    assert store.closed


def test_runtime_service_mode_starts_and_closes(monkeypatch):
    worker, store = FakeWorker(), FakeStore()
    monkeypatch.setattr(runtime, "build_worker_from_environment", lambda: (worker, store))
    assert runtime.main([]) == 0
    assert worker.ran_forever
    assert store.closed
