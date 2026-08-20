# Krea 2 LoRA catalog

Last researched: 2026-07-30. Source metadata comes from the listed Civitai model/version pages and
their public API records. These are third-party adapters; compatibility means the creator labels the
release for Krea 2, not that Z-Image Studio has completed a visual quality benchmark.

## Catalog roles

| Role | LoRA | Version/file | Activation | Starting strength |
| --- | --- | --- | --- | ---: |
| Social/UGC style | FameGrid Krea 2 Standard v1 | `3154245` / `Famegrid Standard Krea 2.safetensors` | `famegrid`, first in prompt | 0.8 |
| Character/style | Alt Girl Krea | local / `AltGirlKrea.safetensors` | `AltGirl` | 0.7 |
| Body | PAWG Krea 2 | local / `pawg_krea2.safetensors` | None confirmed; describe proportions | 0.7 |
| Body | Flat Chested Krea 2 v3 | local / `Krea 2 - Flat Chested v3.safetensors` | None in file; describe chest proportions | 0.7 |
| Style/realism | BloomGirls UltraRealism | `3075850` / `bloomgirls-ultrarealism-krea2_4k.safetensors` | None | 0.7 |
| Realism | Krea2 Realism V2 | `3090634` / `Krea2-realism-V2.safetensors` | None | 1.0 |
| Character concept | Cutifyier | `3107521` / `cutifier_krea2.safetensors` | None required; creator also mentions `ukgirl` only for the older Z-Image release | 0.75 |
| Realism/concepts | Realism Engine Krea 2 v3 | `3109006` / `realism_engine_krea2_v3.1.safetensors` | Natural-language concepts | 0.7 |
| Utility | TextFusion Refusal Reduction | `3125118` / `Krea2_TextFusion_Refusal_Reduction.safetensors` | None | 1.0 |
| Body | SBBT | `3170283` / `SBBT_B_e46.safetensors` | `SBBT`, at the front of the prompt | 0.9 |

## Individual usage notes

### FameGrid Krea 2 Standard v1

- Source: https://civitai.red/models/2088956?modelVersionId=3154245
- Exact architecture: Krea 2. Do not substitute the Z-Image or Qwen versions listed on the same
  model page.
- Activation: start the prompt with `famegrid`; Studio inserts and deduplicates it automatically.
- Intended effect: premium social-media/UGC imagery, natural posing and body language, believable
  skin, polished lighting, and clean lifestyle, fashion, beauty, product, and campaign compositions.
- Creator generation range: 8–16 steps, guidance 1. Studio's verified Krea defaults of 8 steps and
  CFG 1 already fit this range; sampler remains the architecture-verified Studio default.
- Weight: creator did not publish a fixed numeric LoRA weight for this version. Studio conservatively
  starts at 0.8 alone; use roughly 0.65–0.75 beside another realism/style LoRA.
- Recommended stack order: character/identity → body → FameGrid → optional action/utility. Avoid
  adding BloomGirls and Realism Engine at full strength on the first test.
- SHA-256: `40CE4EBD8AF41F985EF7FF0B15C4989EACEC155B9975C9649DBCE00BA31FED46`
- Embedded metadata: Krea 2, AI Toolkit 0.10.19, 12,040 steps, epoch 7.
- Civitai permissions: credit required; image use and rental allowed; model sale, derivatives, and
  different-license redistribution are not allowed.

### Alt Girl Krea

- Embedded metadata identifies the Krea 2 base, AI Toolkit 0.10.20, 5,000 steps, and training tag
  `AltGirl`; Studio therefore inserts `AltGirl` when selected.
- Existing completed local generations confirm it loads at 0.7 with Krea 2.
- Use for an adult alternative/egirl styling direction and still describe hair, makeup, outfit,
  setting, and expression explicitly.
- SHA-256: `BAD37E52A63F838B4D64A2C05DD8C19CC572C6120AABC5958FAE24C85D26CC97`
- The original source URL and license are not recorded locally. Do not assume redistribution rights.

### PAWG Krea 2

- Embedded metadata identifies the Krea 2 base and AI Toolkit 0.10.18 at 3,250 steps, but contains
  no activation tag. Studio deliberately inserts no trigger word.
- Existing completed local generations confirm it loads at 0.7 with Krea 2.
- Describe the intended adult body proportions and clothing directly; lower the weight when stacking
  another body adapter.
- SHA-256: `6DF1AE992E4AC7AE2E5576B01074F31CC6BA20C442711D9B87E920996C24C30D`
- The original source URL and license are not recorded locally. Do not assume redistribution rights.

### BloomGirls UltraRealism

- Source: https://civitai.red/models/2735553?modelVersionId=3075850
- Intended effect: soft bloom, saturated polish, photorealistic influencer/lifestyle styling.
- Creator showcase: Krea 2 Raw plus Turbo LoRA, 12 steps, CFG 1, `er_sde`, simple scheduler.
- Studio note: keep the verified Krea Turbo defaults initially; treat the creator's sampler as an
  optional future benchmark because Studio does not expose it today.
- Installed file: the version's primary `4k` model. The same version also exposes optional `3k`
  and background-helper files; they were not installed.
- SHA-256: `D1BFAEBD3A76B5A2D4C87FD903BCC5B46918A8FCA7FD6A2274769FE6622C598F`
- Civitai permissions reported by API: image use, Civitai rental, rental, sale; credit optional;
  derivatives and different licenses allowed.

### Krea2 Realism V2

- Source: https://civitai.red/models/2728365?modelVersionId=3090634
- Intended effect: more natural textures, lighting, composition, and facial expressions.
- Prompting: use a descriptive natural-language paragraph rather than a one-line tag list.
- Strength: creator says 1.0 is general purpose and personally prefers 1.5–2.0 for a stronger effect.
  Studio starts at 1.0 to avoid overpowering other character/body adapters.
- SHA-256: `FB0048CE3340ADC2842CCFCC1A9A61A9773B6628B01AE5A2E139CA9C679E715D`
- Civitai permissions reported by API: image use and rental; credit required; derivatives allowed;
  different-license redistribution and selling the model are not allowed.

### Cutifyier

- Source: https://civitai.red/models/2187487?modelVersionId=3107521
- Intended effect: a younger/cuter adult feminine facial structure and shape.
- Krea v2 release note says no trigger word is needed. `ukgirl` belongs to the older Z-Image release
  and is deliberately not auto-inserted for this Krea file.
- SHA-256: `7187237737FC5A505D32883C4049625D3CB56AD829179BBF27BE0966C7D3FAE4`
- Civitai permissions reported by API: rental; credit optional; derivatives allowed; image sale and
  different-license redistribution are not granted by the API record.

### Realism Engine Krea 2 v3

- Source: https://civitai.red/models/2688234?modelVersionId=3109006
- Intended effect: broader concept knowledge and realism.
- Strength: creator guidance across Krea releases centers around 0.5–0.9 and warns against going
  above 0.9. Studio starts at 0.7.
- The creator's v3 workflow mentions external VAE utility/upscale components. They are not required
  for loading the LoRA and are not installed by this catalog.
- SHA-256: `A6712629445A2E91A616568E82BEFA8C8C7518E891A0F7C9918138634B5B54A5`
- Civitai permissions reported by API: image use, rental, and sale; credit optional; derivatives
  allowed; different-license redistribution is not allowed.

### Krea2 TextFusion Refusal Reduction

- Source: https://civitai.red/models/2775340?modelVersionId=3125118
- Role: conditioning utility, not a character/style/concept LoRA. It targets Krea TextFusion layers
  and is intended to reduce learned refusal behavior without replacing visual knowledge.
- Strength: creator specifies 1.0.
- SHA-256: `84EC722DDAB93F6489C5315BCA25DE5DD1A7B7EC5045A3C4CE2F97F62E54E8E6`
- Civitai permissions reported by API: image use, rental, and sale; credit optional; derivatives
  allowed; different-license redistribution is not allowed.

### SBBT

- Source: https://civitai.red/models/2811208?modelVersionId=3170283
- Role: body-proportion LoRA for a slim build with a large bust; it is not an anatomy-quality fix.
- Activation: put `SBBT` at the front of the prompt. The Studio inserts it automatically.
- Strength: creator recommends 0.9 when used alone.
- Prompt shape: `SBBT, [framing/capture] of [adult subject traits] in [environment], [proportion and
  clothing details], [lighting], [background]`.
- SHA-256: `43024AC930F36ABBA87221E0DB1DD72F8C62116126CE0A27F9B6BE62BD4E8BD3`
- Civitai permissions reported by API: image use and rental; credit optional; derivatives and
  different licenses allowed; selling the model itself is not granted by the API record.

## Safe stacking pattern

Start with one adapter from each role:

1. Character or identity LoRA: 0.65–0.8.
2. Body LoRA: 0.7–0.9.
3. One realism/style LoRA: 0.6–1.0.
4. Action/concept LoRA only when the prompt needs it: 0.5–0.8.
5. Utility LoRA at its documented strength.

Avoid stacking both large realism engines at their maximum strength on the first test. Use a fixed
seed and prompt, add one LoRA at a time, and lower the newest adapter first when identity, anatomy,
or composition drifts.
