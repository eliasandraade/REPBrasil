from __future__ import annotations

from dataclasses import dataclass
import json
import random
import threading
import time
from typing import Callable, Protocol

import httpx


class TSEFetchError(RuntimeError):
    pass


class TSENotFound(TSEFetchError):
    pass


@dataclass(frozen=True)
class CachedArtifact:
    body: bytes
    etag: str | None = None
    last_modified: str | None = None


class ArtifactCache(Protocol):
    def get(self, key: str) -> CachedArtifact | None: ...
    def put(self, key: str, value: CachedArtifact) -> None: ...


class MemoryArtifactCache:
    def __init__(self) -> None:
        self._items: dict[str, CachedArtifact] = {}

    def get(self, key: str) -> CachedArtifact | None:
        return self._items.get(key)

    def put(self, key: str, value: CachedArtifact) -> None:
        self._items[key] = value


class RateLimiter:
    """Thread-safe ceiling. Default 8 req/s, intentionally far below TSE's 100 req/s/IP limit."""

    def __init__(self, requests_per_second: float = 8.0, *, clock: Callable[[], float] = time.monotonic, sleep: Callable[[float], None] = time.sleep) -> None:
        if requests_per_second <= 0:
            raise ValueError("requests_per_second must be positive")
        self.interval = 1.0 / requests_per_second
        self.clock = clock
        self.sleep = sleep
        self._lock = threading.Lock()
        self._next = 0.0

    def wait(self) -> None:
        with self._lock:
            now = self.clock()
            if now < self._next:
                self.sleep(self._next - now)
                now = self.clock()
            self._next = max(now, self._next) + self.interval


class TSEHttpClient:
    def __init__(
        self,
        *,
        client: httpx.Client | None = None,
        cache: ArtifactCache | None = None,
        rate_limiter: RateLimiter | None = None,
        max_retries: int = 3,
        backoff_base: float = 0.5,
        sleep: Callable[[float], None] = time.sleep,
        jitter: Callable[[], float] = random.random,
    ) -> None:
        self.client = client or httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0), follow_redirects=True)
        self.cache = cache or MemoryArtifactCache()
        self.rate_limiter = rate_limiter or RateLimiter()
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self.sleep = sleep
        self.jitter = jitter

    def close(self) -> None:
        self.client.close()

    def _request(self, url: str, *, cache_key: str | None = None) -> bytes:
        key = cache_key or url
        cached = self.cache.get(key)
        headers: dict[str, str] = {"Accept": "application/json, application/octet-stream;q=0.9, */*;q=0.1"}
        if cached is not None and cached.etag:
            headers["If-None-Match"] = cached.etag
        if cached is not None and cached.last_modified:
            headers["If-Modified-Since"] = cached.last_modified

        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            self.rate_limiter.wait()
            try:
                response = self.client.get(url, headers=headers)
            except httpx.HTTPError as exc:
                last_error = exc
                if attempt >= self.max_retries:
                    break
                self._backoff(attempt)
                continue

            if response.status_code == 304:
                if cached is None:
                    raise TSEFetchError(f"TSE returned 304 without a cached artifact for {url}")
                return cached.body
            if response.status_code == 404:
                raise TSENotFound(f"TSE artifact not found: {url}")
            if response.status_code == 429 or 500 <= response.status_code <= 599:
                last_error = TSEFetchError(f"TSE transient HTTP {response.status_code}: {url}")
                if attempt >= self.max_retries:
                    break
                retry_after = response.headers.get("Retry-After")
                if retry_after and retry_after.isdigit():
                    self.sleep(float(retry_after))
                else:
                    self._backoff(attempt)
                continue
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise TSEFetchError(f"TSE HTTP {response.status_code}: {url}") from exc

            artifact = CachedArtifact(
                body=response.content,
                etag=response.headers.get("ETag"),
                last_modified=response.headers.get("Last-Modified"),
            )
            self.cache.put(key, artifact)
            return artifact.body

        raise TSEFetchError(f"failed to fetch TSE artifact after retries: {url}") from last_error

    def _backoff(self, attempt: int) -> None:
        delay = self.backoff_base * (2**attempt) + self.jitter() * self.backoff_base
        self.sleep(delay)

    def get_bytes(self, url: str, *, cache_key: str | None = None) -> bytes:
        return self._request(url, cache_key=cache_key)

    def get_json(self, url: str, *, cache_key: str | None = None) -> object:
        payload = self._request(url, cache_key=cache_key)
        try:
            return json.loads(payload)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise TSEFetchError(f"invalid JSON from TSE: {url}") from exc
