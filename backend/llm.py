"""The ONLY place that talks to OpenRouter.

- Two tiers: fast (Haiku) and smart (Sonnet), set via env.
- Every response is JSON validated against a Pydantic model (one retry on failure).
- Responses are cached by sha256(model + prompts) so dev reruns and demo precompute cost $0.
- Every call's real cost (OpenRouter `usage.cost`) is logged; live calls stop at SPEND_CAP_USD.
"""
import hashlib
import json
import logging
import re
from typing import Type, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

import db
from config import APP_URL, MODEL_FAST, MODEL_SMART, OPENROUTER_API_KEY, SPEND_CAP_USD

log = logging.getLogger("llm")
T = TypeVar("T", bound=BaseModel)
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

_client: httpx.AsyncClient | None = None


class BudgetExceeded(Exception):
    pass


class LLMError(Exception):
    pass


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=10.0))
    return _client


def model_for(tier: str) -> str:
    return MODEL_SMART if tier == "smart" else MODEL_FAST


def _extract_json(text: str) -> str:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    start = min([i for i in (text.find("{"), text.find("[")) if i != -1], default=-1)
    if start == -1:
        raise ValueError("no JSON found")
    end = max(text.rfind("}"), text.rfind("]"))
    return text[start:end + 1]


async def _raw_call(model: str, system: str, user: str, max_tokens: int, temperature: float):
    if not OPENROUTER_API_KEY:
        raise LLMError("OPENROUTER_API_KEY is not set")
    if db.total_spend() >= SPEND_CAP_USD:
        raise BudgetExceeded(f"Spend cap of ${SPEND_CAP_USD:.2f} reached")
    resp = await _http().post(
        OPENROUTER_URL,
        headers={
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "HTTP-Referer": APP_URL,
            "X-Title": "StackSmith",
        },
        json={
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            # Haiku 5.5 thinks adaptively and hidden reasoning ate the JSON budget, so it is off for the
            # fast tier. Sonnet 5.5 requires reasoning, so the smart tier runs it at low effort.
            "reasoning": {"enabled": False} if model == MODEL_FAST else {"effort": "low"},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "usage": {"include": True},
        },
    )
    if resp.status_code != 200:
        raise LLMError(f"OpenRouter {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    if "choices" not in data:
        raise LLMError(f"OpenRouter error: {str(data)[:300]}")
    choice = data["choices"][0]
    return choice["message"].get("content") or "", data.get("usage", {}), choice.get("finish_reason")


async def call_json(
    *, tier: str, system: str, user: str, schema: Type[T], node: str, run_id: str | None = None,
    max_tokens: int = 1500, temperature: float = 0.3, use_cache: bool = True,
) -> T:
    model = model_for(tier)
    schema_hint = json.dumps(schema.model_json_schema(), separators=(",", ":"))
    full_system = (
        f"{system}\n\nRespond with ONLY a single JSON object that validates against this JSON Schema. "
        f"No prose, no markdown fences.\nSchema: {schema_hint}"
    )
    key = hashlib.sha256(f"{model}\n{full_system}\n{user}".encode()).hexdigest()

    if use_cache:
        cached = db.cache_get(key)
        if cached:
            try:
                return schema.model_validate_json(cached)
            except ValidationError:
                pass

    last_err = None
    prompt = user
    for attempt in range(2):
        content, usage, finish = await _raw_call(model, full_system, prompt, max_tokens, temperature)
        db.log_llm_call(run_id, node, model, usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0),
                        float(usage.get("cost") or 0.0))
        if finish == "length":
            max_tokens = int(max_tokens * 1.8)  # truncated JSON: give the retry more room
        try:
            parsed = schema.model_validate_json(_extract_json(content))
            db.cache_put(key, parsed.model_dump_json())
            return parsed
        except (ValueError, ValidationError) as e:
            last_err = e
            log.warning("node %s: invalid JSON on attempt %d: %s", node, attempt + 1, e)
            prompt = (f"{user}\n\nYour previous answer was invalid ({str(e)[:300]}). "
                      f"Return ONLY valid JSON matching the schema.")
    raise LLMError(f"{node}: model returned invalid JSON twice: {last_err}")
