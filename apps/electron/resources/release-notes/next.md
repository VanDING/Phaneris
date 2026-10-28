# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits. The in-app loader only reads `X.Y.Z.md` files, so this file is never shown to users.

## Features

## Improvements

- **Simpler API setup** — Provider presets no longer require model selection during connection setup. Custom endpoints discover models before validation, while auxiliary models and the default `call_llm` model are configurable in AI settings.
- **Model-relative context controls** — Automatic compaction thresholds can be selected as percentages of the active model's context window, preserving legacy token limits and the SDK safety reserve.
- **Clearer decision settings** — Hide retired adaptive-thinking, mid-turn classification and large-result filtering switches while retaining compatibility with stored settings.
- **Compatible image providers** — Image generation can use explicitly selected OpenAI-compatible Images API connections with a separately configured image model.
- **Current image capabilities** — Remove the retired GPT Image 1 model from the OpenAI picker and allow GPT Image 2 transparent output to reach the provider for account-level availability checks.

## Bug Fixes

- **Stable connection setup** — Remove overlapping onboarding transitions, resolve connection icons from the provider or endpoint, and include bundled OpenCode and Command Code marks.
- **Custom endpoint output budgets** — Stop inheriting another provider's output ceiling for same-named models. Custom Chat Completions omit default output caps while preserving explicit and internal limits.
- **Accurate unknown costs** — Show unknown pricing separately from a real zero, while retaining known subtotals when only part of the request history is priced.

## Breaking Changes
