# Prompt Engine automation API

Run `npm run smoke:prompt` from `Z:\codex app` for an opt-in live acceptance check. It performs
Prompt Engine generation, validation, a low-priority 512px ComfyUI submission, and waits for a PNG.
It prints `SKIP` without failing when the local Studio/ComfyUI services are unavailable.

All routes bind to the existing local Studio server at `http://127.0.0.1:3199`. There is no remote
authentication because the application is localhost-only. These routes never submit inference on
their own; use the existing multipart `POST /api/generate` only after validation succeeds.

## Library

`GET /api/prompt-library?architecture=krea2&category=ugc&complexity=detailed&keyword=rooftop`

Returns `{ entries, negativePresets }`. Unresolved entries are visible for review but never proposed.

## Generate a draft

`POST /api/prompt/generate`

```json
{
  "architecture": "krea2",
  "entryIds": ["CM-19"],
  "keywords": ["golden hour", "red jacket"],
  "complexity": "detailed",
  "confirmedLoras": []
}
```

Returns a model-aware prompt, negative prompt, selected LoRAs, and `proposedLoras`. Krea/Z-Image use
natural-language prose; Illustrious uses comma-separated tags. Proposals require confirmation.

## Resolve only

`POST /api/prompt/resolve-loras` accepts the same selection input and returns proposals with filename,
weight, confidence, reason, and registry category.

## Validate

`POST /api/prompt/validate` accepts the generated draft. It returns
`{ ok, blocks, warnings, normalized }`. Never submit when `ok` is false. Hard blocks cover
cross-architecture, unresolved/uninstalled LoRAs, embedded `<lora:...>` syntax, invalid weights, and
ambiguous-age prompts without an adult recast.

## Character presets

- `GET/POST /api/character-presets`
- `PUT/DELETE /api/character-presets/:id`
- `GET /api/character-presets/:id/generation` returns Prompt Engine input.
- `GET /api/character-presets/:id/promote` returns a Dataset Builder handoff payload.

Presets are reference-based consistency helpers, not identity locks. Krea identity references are
strong; Z-Image face preservation remains approximate. Promotion reuses Dataset Builder and LoRA Lab.
