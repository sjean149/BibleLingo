"""
Combines two copies of a learner's progress (the account's and a device's) without losing work.

The app's copy of this logic is mergeProgress in bible-lang-app/src/progress/logic.js; keep the
two in step. Rules:
  - steps (finished steps per "lang:chapterId"): joined, so a step done anywhere counts
  - days (practice days, for the streak): joined
  - premium: kept if either copy has it
  - everything else (lang, base, speed, last chapter): from the copy saved most recently (savedAt)
Hearts are not synced: they refill on a clock on each device.
"""
from typing import Any

STEP_ORDER = ["vocab", "reading", "lesson"]
SYNCED_SETTINGS = ["lang", "base", "speed", "last"]


def _steps(value: Any) -> dict[str, list[str]]:
    if not isinstance(value, dict):
        return {}
    return {
        str(key): [s for s in done if isinstance(s, str)]
        for key, done in value.items()
        if isinstance(done, list)
    }


def _days(value: Any) -> list[str]:
    return [d for d in value if isinstance(d, str)] if isinstance(value, list) else []


def _saved_at(copy: dict[str, Any]) -> float:
    value = copy.get("savedAt")
    return float(value) if isinstance(value, (int, float)) else 0.0


def _order_steps(steps: set[str]) -> list[str]:
    known = [s for s in STEP_ORDER if s in steps]
    return known + sorted(steps - set(STEP_ORDER))


def merge_progress(account: dict[str, Any], device: dict[str, Any]) -> dict[str, Any]:
    newer, older = (device, account) if _saved_at(device) >= _saved_at(account) else (account, device)

    steps: dict[str, set[str]] = {}
    for copy in (account, device):
        for key, done in _steps(copy.get("steps")).items():
            steps.setdefault(key, set()).update(done)

    merged: dict[str, Any] = {key: older[key] for key in SYNCED_SETTINGS if key in older}
    merged.update({key: newer[key] for key in SYNCED_SETTINGS if key in newer})
    merged["steps"] = {key: _order_steps(done) for key, done in sorted(steps.items())}
    merged["days"] = sorted(set(_days(account.get("days"))) | set(_days(device.get("days"))))
    merged["premium"] = bool(account.get("premium")) or bool(device.get("premium"))
    merged["savedAt"] = max(_saved_at(account), _saved_at(device))
    return merged
