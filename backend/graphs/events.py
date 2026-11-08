"""In-process run channels: nodes emit events, the SSE endpoint streams them (reconnect-safe by seq)."""
import asyncio
import time
from dataclasses import dataclass, field

TERMINAL = {"approval.waiting", "run.complete", "run.error"}


@dataclass
class RunChannel:
    run_id: str
    started: float = field(default_factory=time.monotonic)
    events: list[dict] = field(default_factory=list)
    cond: asyncio.Condition = field(default_factory=asyncio.Condition)
    status: str = "running"

    async def emit(self, type_: str, data: dict | None = None, agent: str | None = None):
        ev = {"seq": len(self.events), "t": int((time.monotonic() - self.started) * 1000), "type": type_,
              "agent": agent, "data": data or {}}
        async with self.cond:
            self.events.append(ev)
            if type_ in TERMINAL:
                self.status = {"approval.waiting": "awaiting_approval", "run.complete": "complete",
                               "run.error": "error"}[type_]
            self.cond.notify_all()
        return ev

    def mark_resumed(self):
        self.status = "running"


RUNS: dict[str, RunChannel] = {}


def channel(run_id: str) -> RunChannel:
    if run_id not in RUNS:
        RUNS[run_id] = RunChannel(run_id)
    return RUNS[run_id]


async def emit(run_id: str, type_: str, data: dict | None = None, agent: str | None = None):
    return await channel(run_id).emit(type_, data, agent)
