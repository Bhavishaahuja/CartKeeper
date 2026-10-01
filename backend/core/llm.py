import os

from langchain_anthropic import ChatAnthropic

MODEL = "claude-opus-5-5"


def make_llm() -> ChatAnthropic:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise SystemExit("ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in.")
    return ChatAnthropic(
        model=MODEL,
        max_tokens=16000,
        effort=os.environ.get("CARTKEEPER_EFFORT", "medium"),
        # If a safety classifier declines a request, the API retries it on a
        # fallback model instead of returning an empty refusal.
        betas=["server-side-fallback-2026-07-01"],
        model_kwargs={"fallbacks": "default"},
    )
