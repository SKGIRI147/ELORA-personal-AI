CRISIS_KEYWORDS = {
    "suicide", "kill myself", "end my life", "harm myself",
    "murder", "kill someone", "rape",
}

class CrisisCounter:
    def __init__(self):
        self.count = 0
    def record(self, text: str) -> int:
        lower = text.lower()
        if any(k in lower for k in CRISIS_KEYWORDS):
            self.count += 1
        return self.count

COUNTERS = {}

def get_counter(user_uid: str) -> CrisisCounter:
    if user_uid not in COUNTERS:
        COUNTERS[user_uid] = CrisisCounter()
    return COUNTERS[user_uid]
