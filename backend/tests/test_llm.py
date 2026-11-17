import pytest

from backend.core import llm


@pytest.fixture
def clean_env(monkeypatch):
    for v in (*llm.KEY_VARS, "ANTHROPIC_BASE_URL", "CARTKEEPER_ANTHROPIC_BASE_URL"):
        monkeypatch.delenv(v, raising=False)
    return monkeypatch


def test_missing_key_exits(clean_env):
    with pytest.raises(SystemExit):
        llm.make_llm()


def test_cartkeeper_key_wins(clean_env):
    clean_env.setenv("ANTHROPIC_API_KEY", "sk-generic")
    clean_env.setenv("CARTKEEPER_ANTHROPIC_API_KEY", "sk-cartkeeper")
    assert llm.make_llm().anthropic_api_key.get_secret_value() == "sk-cartkeeper"


def test_inherited_base_url_is_ignored(clean_env):
    clean_env.setenv("ANTHROPIC_API_KEY", "sk-generic")
    clean_env.setenv("ANTHROPIC_BASE_URL", "http://some-host-proxy")
    assert llm.make_llm().anthropic_api_url == "https://api.anthropic.com"
