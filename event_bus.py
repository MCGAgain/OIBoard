"""Lightweight in-process SSE event bus keyed by user_id (zero external dependencies, zero idle overhead)."""

import asyncio
import json
import time
from typing import Any, Dict, Optional, Set


class EventBus:
    def __init__(self) -> None:
        self._subscribers: Dict[int, Set[asyncio.Queue]] = {}

    def subscribe(self, user_id: int) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=32)
        self._subscribers.setdefault(user_id, set()).add(q)
        return q

    def unsubscribe(self, user_id: int, q: asyncio.Queue) -> None:
        bucket = self._subscribers.get(user_id)
        if not bucket:
            return
        bucket.discard(q)
        if not bucket:
            self._subscribers.pop(user_id, None)

    def _enqueue(self, q: asyncio.Queue, message: str) -> None:
        if q.full():
            try:
                q.get_nowait()
            except asyncio.QueueEmpty:
                pass
        try:
            q.put_nowait(message)
        except asyncio.QueueFull:
            pass

    def publish(self, user_id: int, event_type: str, payload: Optional[Dict[str, Any]] = None) -> None:
        bucket = self._subscribers.get(user_id)
        if not bucket:
            return
        data = {
            "type": event_type,
            "ts": int(time.time() * 1000),
            "data": payload or {},
        }
        msg = json.dumps(data, ensure_ascii=False)
        for q in list(bucket):
            self._enqueue(q, msg)

    def publish_all(self, event_type: str, payload: Optional[Dict[str, Any]] = None) -> None:
        if not self._subscribers:
            return
        data = {
            "type": event_type,
            "ts": int(time.time() * 1000),
            "data": payload or {},
        }
        msg = json.dumps(data, ensure_ascii=False)
        for bucket in list(self._subscribers.values()):
            for q in list(bucket):
                self._enqueue(q, msg)


event_bus = EventBus()
