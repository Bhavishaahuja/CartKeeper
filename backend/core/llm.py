import os

from langchain_anthropic import ChatAnthropic

MODEL = "claude-opus-5-5"
API_URL = "https://api.anthropic.com"

# CARTKEEPER_ANTHROPIC_API_KEY wins so the app's key can't collide with a host
# that sets ANTHROPIC_* for its own use (Claude Code cloud sessions do).
KEY_VARS = ("CARTKEEPER_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY")


def api_key() -> str | None:
    return next((os.environ[v] for v in KEY_VARS if os.environ.get(v)), None)


def make_llm() -> ChatAnthropic:
    key = api_key()
    if not key:
        raise SystemExit(
            "No Anthropic API key. Set CARTKEEPER_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY) in .env."
        )
    return ChatAnthropic(
        model=MODEL,
        api_key=key,
        # Pinned so an inherited ANTHROPIC_BASE_URL can't reroute the app's calls.
        base_url=os.environ.get("CARTKEEPER_ANTHROPIC_BASE_URL", API_URL),
        max_tokens=16000,
        effort=os.environ.get("CARTKEEPER_EFFORT", "medium"),
        # If a safety classifier declines a request, the API retries it on a
        # fallback model instead of returning an empty refusal.
        betas=["server-side-fallback-2026-07-01"],
        model_kwargs={"fallbacks": "default"},
    )
