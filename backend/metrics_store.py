"""
metrics_store.py — Thread-safe in-memory sliding-window metrics.

Tracks the last 60 seconds of:
  • requests
  • errors
  • LLM token usage

Design notes:
  - A single RLock (reentrant) is used for all mutations.
  - _prune is ONLY called from get_metrics_snapshot (never from record_*).
    record_* functions simply append; the deques grow until the next snapshot.
    This eliminates any TOCTOU race between append and prune.

Public API:
    record_request()
    record_error()
    record_tokens(n: int)
    get_metrics_snapshot() -> dict
"""

import time
import threading
from collections import deque

# Use an RLock so the same thread can re-acquire it safely.
_lock = threading.RLock()
_WINDOW_SEC = 60  # rolling window in seconds

# Each deque stores timestamps (float) of events.
# _tokens stores (timestamp, count) tuples.
_requests: deque = deque()
_errors: deque = deque()
_tokens: deque = deque()


def _prune_simple(dq: deque, cutoff: float) -> None:
    """
    Remove all entries from the left of the deque whose timestamp < cutoff.
    Entries in _requests and _errors are plain floats (timestamps).
    Entries in _tokens are (timestamp, count) tuples.
    Must be called while _lock is held.
    """
    try:
        while dq:
            head = dq[0]
            ts = head[0] if isinstance(head, tuple) else float(head)
            if ts < cutoff:
                dq.popleft()
            else:
                break
    except (IndexError, TypeError):
        # Defensive: should never happen, but never crash the server.
        pass


# ── Public recorders ────────────────────────────────────────────────────

def record_request() -> None:
    """Call once per incoming HTTP request."""
    now = time.time()
    with _lock:
        _requests.append(now)


def record_error() -> None:
    """Call whenever a 5xx / unhandled exception occurs."""
    now = time.time()
    with _lock:
        _errors.append(now)


def record_tokens(n: int) -> None:
    """Call with the estimated/actual token count for an LLM call."""
    now = time.time()
    with _lock:
        _tokens.append((now, int(n)))


# ── Snapshot ─────────────────────────────────────────────────────────────

def get_metrics_snapshot() -> dict:
    """
    Return a point-in-time snapshot of the last 60 seconds.
    Prunes stale entries and computes derived metrics.

    Returns:
        {
            "requests_per_min": int,
            "errors_per_min": int,
            "error_rate_pct": float,
            "tokens_per_min": int,
            "window_seconds": 60,
        }
    """
    now = time.time()
    cutoff = now - _WINDOW_SEC

    with _lock:
        _prune_simple(_requests, cutoff)
        _prune_simple(_errors, cutoff)
        _prune_simple(_tokens, cutoff)

        req_count = len(_requests)
        err_count = len(_errors)
        tok_count = sum(t[1] for t in _tokens)

    error_rate = float(err_count / req_count * 100) if req_count > 0 else 0.0

    return {
        "requests_per_min": req_count,
        "errors_per_min": err_count,
        "error_rate_pct": round(error_rate, 2),
        "tokens_per_min": tok_count,
        "window_seconds": _WINDOW_SEC,
    }
