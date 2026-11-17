"""A stand-in for ChatAnthropic so graph tests run without an API key."""


class FakeLLM:
    """`responders` maps a schema name ("Need", "Choice") to fn(schema, messages) -> dict."""

    def __init__(self, responders):
        self.responders = responders
        self.calls = []

    def with_structured_output(self, schema, method=None):
        assert method == "json_schema", "structured output must use json_schema"
        return _Bound(self, schema)


class _Bound:
    def __init__(self, llm, schema):
        self.llm, self.schema = llm, schema

    def invoke(self, messages):
        self.llm.calls.append((self.schema.__name__, messages))
        data = self.llm.responders[self.schema.__name__](self.schema, messages)
        return self.schema.model_validate(data)
