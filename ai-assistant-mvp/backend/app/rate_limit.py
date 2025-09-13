import time
from typing import Dict, Tuple

# naive in-memory token bucket per IP
BUCKETS: Dict[str, Tuple[float, float]] = {}  # ip -> (tokens, last_ts)
RATE = 1.0  # tokens per second
BURST = 10.0

def allow(ip: str) -> bool:
    now = time.time()
    tokens, last = BUCKETS.get(ip, (BURST, now))
    tokens = min(BURST, tokens + (now - last) * RATE)
    if tokens >= 1.0:
        BUCKETS[ip] = (tokens - 1.0, now)
        return True
    BUCKETS[ip] = (tokens, now)
    return False
