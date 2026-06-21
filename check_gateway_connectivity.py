#!/usr/bin/env python3

import json
import sys
import urllib.error
import urllib.request
from typing import Any, Dict, Optional, Tuple


KEY = "sk-60ffa056bc023a5a4905c72a6e5135765566778ad0411424c53a7c8e3447094a"
BASE = "http://127.0.0.1:8080"


def request_json(path: str, payload: Optional[Dict[str, Any]] = None) -> Tuple[int, Dict[str, Any]]:
    data = None
    headers = {
        "Authorization": f"Bearer {KEY}",
    }
    if payload is not None:
        data = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(f"{BASE}{path}", data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode()
            return resp.status, json.loads(body)
    except urllib.error.HTTPError as err:
        body = err.read().decode()
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = {"raw_body": body}
        return err.code, parsed


def print_section(title: str) -> None:
    print(f"\n=== {title} ===")


def main() -> int:
    print_section("/v1/models")
    status, body = request_json("/v1/models")
    print(f"HTTP {status}")
    print(json.dumps(body, ensure_ascii=False, indent=2))

    print_section("/v1/messages success case")
    status, body = request_json(
        "/v1/messages",
        {
            "model": "deepseek-v4-pro",
            "max_tokens": 64,
            "messages": [
                {"role": "user", "content": "Reply with exactly: pong"}
            ],
        },
    )
    print(f"HTTP {status}")
    print(json.dumps(body, ensure_ascii=False, indent=2))

    print_section("/v1/messages unsupported model case")
    status, body = request_json(
        "/v1/messages",
        {
            "model": "claude-sonnet-4-5-20250929",
            "max_tokens": 64,
            "messages": [
                {"role": "user", "content": "Reply with exactly: pong"}
            ],
        },
    )
    print(f"HTTP {status}")
    print(json.dumps(body, ensure_ascii=False, indent=2))

    return 0


if __name__ == "__main__":
    sys.exit(main())
