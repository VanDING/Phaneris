# LLM Tool (`call_llm`)

`call_llm` is available for an additional, isolated model completion: summarize a file, classify records, or extract structured data. It has no tools and does not inherit the main conversation. Supply the task, relevant constraints, and input explicitly. Calls use the active agent backend's authenticated model runtime; there is no separate direct-Anthropic API-key feature path.

## Choose the right path

| Need | Path |
|------|------|
| Reason about the current conversation | Continue in the main session |
| Isolated text processing | `call_llm` with a prompt and optional text-file attachments |
| Inspect an image | Use the main session's image input/read capability with a vision-capable model |
| Explore files or use other tools autonomously | Use an available agent/session delegation tool, when appropriate to the user's scope |

**Image support is specific to the input path.** The chat/model-picker “Enable image support” control enables image input for that configured model in the main conversation. It does not enable image attachments in `call_llm`: this tool currently rejects them before making the model request, including for vision-capable models and API-key connections. Do not retry that rejection by changing authentication. Image support in this secondary-call path is a capability gap, not evidence that the main session cannot see images.

## Parameters

Use the live tool schema for exact accepted fields. The current fields are:

| Parameter | Type | Meaning |
|-----------|------|---------|
| `prompt` | string, required | Instructions and/or inline text to process |
| `attachments` | array | Existing text-file paths, or `{ path, startLine?, endLine? }` objects |
| `model` | string | Requested model ID or recognized short name; availability depends on the configured provider |
| `systemPrompt` | string | Instructions for this isolated completion |
| `maxTokens` | integer, 1–64000 | Requested output limit; effective enforcement depends on the backend |
| `temperature` | number, 0–1 | Requested sampling temperature; effective enforcement depends on the backend |
| `outputFormat` | enum | One of the predefined JSON formats below |
| `outputSchema` | object | Custom JSON Schema; use instead of `outputFormat` |

`thinking` and `thinkingBudget` are not parameters of this tool. Their absence says nothing about the main model's reasoning capability or the main session's thinking setting.

When `model` is omitted, the Pi path uses the configured mini model or a summarization fallback. An unavailable or provider-incompatible request may fall back to a compatible model. Do not promise a particular model or cost from a short name alone. The tool's returned text is not a reliable model-selection receipt; consult runtime metadata when the effective model matters.

## Attachments and limits

- Put inline content in `prompt`, not in `attachments`.
- Use absolute paths when possible. Relative paths resolve from the session path.
- For files over 2000 lines or 500,000 bytes, select a line range, for example `{ "path": "/logs/app.log", "startLine": 100, "endLine": 500 }`. Line numbers are one-based. Keep selected content within the tool's limits.
- Keep calls within 20 attachments and 2,000,000 bytes of combined text. Split larger jobs into independent batches; do not depend on every dispatch path enforcing the same aggregate limit.
- Binary documents are not text attachments. Extract their text first with an appropriate document tool. For images use the main session's vision path, not text conversion as a substitute for visual inspection.

## Structured output

| `outputFormat` | Requested shape |
|----------------|-----------------|
| `summary` | `{ summary, key_points[], word_count? }` |
| `classification` | `{ category, confidence, reasoning }` |
| `extraction` | `{ items[], count }` |
| `analysis` | `{ findings[], issues?: string[], recommendations?: string[] }` |
| `comparison` | `{ similarities[], differences[], verdict }` |
| `validation` | `{ valid, errors[], warnings[] }` |

The current Pi path includes the requested schema in model instructions. This is **prompt-based output guidance**, not a guarantee of valid JSON or schema compliance. Parse and validate the returned text before using it in code or downstream writes. If it fails validation, request a targeted correction with the validation errors; do not silently accept malformed or incomplete data. Structured output also does not establish factual correctness.

```typescript
call_llm({
  prompt: "Extract the HTTP routes declared in this file; do not infer missing routes.",
  attachments: ["/workspace/src/routes.ts"],
  outputSchema: {
    type: "object",
    properties: { routes: { type: "array", items: { type: "string" } } },
    required: ["routes"],
    additionalProperties: false
  }
})
```

## Failure handling

| Failure | Next step |
|---------|-----------|
| Missing/unreadable file | Check the path and access before retrying |
| File or selected range too large | Narrow the range or split the input |
| Image attachment rejected | Use the main session's image capability |
| Unsupported parameter | Correct it against the live schema |
| Authentication/model unavailable | Check the configured connection and available models; request user action only when necessary |
| Timeout or exhausted transient retries | Reduce the work per call or retry a bounded, read-only subtask when recovery is plausible |
| Malformed JSON | Validate, then request a targeted repair |

Utility calls have a bounded runtime deadline (approximately two minutes including the host timeout). The runtime already performs transient-error recovery; do not stack an unbounded retry loop on top. Multiple independent calls can run concurrently, but rate limits, cost, and the user's delegation preferences still apply. Parallel calls do not guarantee a fixed speedup.
