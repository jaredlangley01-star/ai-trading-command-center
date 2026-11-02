"""Simple persistent-process scheduler loop; no broker execution is wired."""
import threading
import time
from collections.abc import Callable, Iterable

class CycleScheduler:
    def __init__(self, cycle: Callable[[str], object], symbols: Iterable[str], interval_seconds: int = 60):
        if interval_seconds < 5: raise ValueError("interval_seconds must be at least 5")
        self.cycle = cycle
        self.symbols = tuple(dict.fromkeys(s.upper() for s in symbols))
        self.interval_seconds = interval_seconds
        self._stop = threading.Event()
    def stop(self): self._stop.set()
    def run_forever(self, on_report: Callable[[object], None] = lambda report: None):
        while not self._stop.is_set():
            started = time.monotonic()
            for symbol in self.symbols:
                if self._stop.is_set(): break
                on_report(self.cycle(symbol))
            remaining = max(0, self.interval_seconds - (time.monotonic() - started))
            self._stop.wait(remaining)
