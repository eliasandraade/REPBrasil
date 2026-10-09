import httpx
import pytest

from src.electoral.http_client import (
    CachedArtifact,
    MemoryArtifactCache,
    TSEFetchError,
    TSEHttpClient,
    TSENotFound,
)


class NoopLimiter:
    def wait(self):
        pass


def test_conditional_get_uses_etag_and_304_cache_body():
    cache = MemoryArtifactCache()
    cache.put("k", CachedArtifact(body=b'{"ok":true}', etag='"etag-1"'))

    def handler(request: httpx.Request):
        assert request.headers["If-None-Match"] == '"etag-1"'
        return httpx.Response(304)

    client = TSEHttpClient(client=httpx.Client(transport=httpx.MockTransport(handler)), cache=cache, rate_limiter=NoopLimiter())
    assert client.get_json("https://example.invalid/x", cache_key="k") == {"ok": True}


def test_success_stores_cache_validators():
    cache = MemoryArtifactCache()
    transport = httpx.MockTransport(lambda _: httpx.Response(200, content=b"payload", headers={"ETag": '"e2"', "Last-Modified": "x"}))
    client = TSEHttpClient(client=httpx.Client(transport=transport), cache=cache, rate_limiter=NoopLimiter())
    assert client.get_bytes("https://example.invalid/a", cache_key="a") == b"payload"
    assert cache.get("a") == CachedArtifact(body=b"payload", etag='"e2"', last_modified="x")


def test_404_is_terminal_and_never_retried_as_discovery():
    calls = 0

    def handler(_: httpx.Request):
        nonlocal calls
        calls += 1
        return httpx.Response(404)

    client = TSEHttpClient(client=httpx.Client(transport=httpx.MockTransport(handler)), rate_limiter=NoopLimiter(), max_retries=5)
    with pytest.raises(TSENotFound):
        client.get_json("https://example.invalid/not-found")
    assert calls == 1


def test_transient_failure_retries_with_backoff_then_succeeds():
    responses = [httpx.Response(503), httpx.Response(200, json={"ok": True})]
    sleeps = []
    client = TSEHttpClient(
        client=httpx.Client(transport=httpx.MockTransport(lambda _: responses.pop(0))),
        rate_limiter=NoopLimiter(),
        max_retries=2,
        backoff_base=0.25,
        sleep=sleeps.append,
        jitter=lambda: 0,
    )
    assert client.get_json("https://example.invalid/retry") == {"ok": True}
    assert sleeps == [0.25]


def test_invalid_json_is_explicit_error():
    client = TSEHttpClient(
        client=httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, content=b"not-json"))),
        rate_limiter=NoopLimiter(),
    )
    with pytest.raises(TSEFetchError, match="invalid JSON"):
        client.get_json("https://example.invalid/json")
