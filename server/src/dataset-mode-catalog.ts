/**
 * Catalog of known Dataset Builder modes.
 *
 * Design (modular / scalable / backwards-compatible):
 * - Runtime schema accepts ANY list-id-shaped mode string (see dataset.ts).
 * - This catalog only drives UI labels, default negatives, cycle notes, and guidance.
 * - Adding a new set = (1) data/dataset-prompt-lists/<id>.json + (2) one entry here.
 * - Unknown ids still work as prompt-list modes with safe defaults (no schema redeploy).
 */

export type DatasetNegativeProfile =
  | "standard"
  | "instagram-ugc"
  /** Solo NSFW character; nudity OK; discourages male subjects. */
  | "nsfw-solo"
  /** NSFW with partner/sub; nudity OK; does NOT ban male. */
  | "nsfw-with-male";

export type DatasetCycleFamily = "standard" | "instagram" | "latex" | "domination" | "choke";

export type DatasetModeCatalogEntry = {
  /** Mode id === prompt list JSON id for list modes (except standard). */
  id: string;
  /** Short label for history cards / summaries. */
  label: string;
  /** Full option text in Dataset mode dropdown. */
  optionLabel: string;
  /** Panel intro under the title. */
  intro: string;
  /** Dataset name input placeholder. */
  placeholderName: string;
  /** Character description placeholder. */
  characterPlaceholder: string;
  /** Seeded into Character description when switching to this mode (if still a known default). */
  defaultBasePrompt?: string;
  /** Negative profile → resolveDatasetNegativePrompt. */
  negativeProfile: DatasetNegativeProfile;
  /** Cycle-pass wording when count > list length. */
  cycleFamily: DatasetCycleFamily;
  /** Right-panel guidance bullets. */
  guidance: string[];
  /** False only for standard directed matrix. */
  isPromptList: boolean;
  /** True for X / adult sets. */
  nsfw?: boolean;
};

/** Directed matrix (not a JSON list). Always first in the UI. */
export const STANDARD_MODE: DatasetModeCatalogEntry = {
  id: "standard",
  label: "Standard",
  optionLabel: "Standard directed variety",
  intro:
    "Creates labelled headshots, medium shots, full-body views, and varied poses while keeping the master character as the identity guide.",
  placeholderName: "My character dataset",
  characterPlaceholder: "Stable identity only — face, hair, body.",
  negativeProfile: "standard",
  cycleFamily: "standard",
  guidance: [
    "40 distinct pose and action slots",
    "Ordered close-up, medium, seated, and full-body coverage",
    "Extensions continue from the next unused slot instead of restarting"
  ],
  isPromptList: false
};

/**
 * First-class list modes shown in the Dataset mode dropdown.
 * Order = UI order after Standard.
 */
export const LIST_MODE_CATALOG: DatasetModeCatalogEntry[] = [
  {
    id: "instagram-ugc",
    label: "Instagram UGC",
    optionLabel: "Instagram UGC LoRA training",
    intro:
      "Instagram UGC: own lifestyle shot collection for clothed character LoRA training. Master image stays the identity guide.",
    placeholderName: "Instagram UGC dataset",
    characterPlaceholder:
      "Stable identity only — face, hair, body. Outfits come from the shot list.",
    defaultBasePrompt:
      "photorealistic adult woman, consistent face and hair, natural skin, Instagram lifestyle aesthetic",
    negativeProfile: "instagram-ugc",
    cycleFamily: "instagram",
    guidance: [
      "Own lifestyle shot collection (separate from Nyx sets)",
      "Clothing-aware default negative",
      "Extensions continue the list instead of restarting"
    ],
    isPromptList: true
  },
  {
    id: "nyx-latex-fetish",
    label: "Nyx latex fetish",
    optionLabel: "Nyx latex fetish (NSFW / X)",
    intro:
      "Nyx latex fetish (NSFW): own solo latex-hood shot list for X-style adult content. Separate from domination, choke, and Instagram. Builds wrap the list. Master image stays the identity guide.",
    placeholderName: "Nyx latex NSFW dataset",
    characterPlaceholder:
      "Stable Nyx identity — body, latex look anchors. Poses/framing come from the Nyx shot list.",
    defaultBasePrompt:
      "photorealistic adult woman Nyx, consistent curvy hourglass figure, black latex aesthetic, large soft red lips",
    negativeProfile: "nsfw-solo",
    cycleFamily: "latex",
    guidance: [
      "Own solo latex collection — not domination/choke, not Instagram",
      "Lips macros · smother POV · crawl · standing · kneeling",
      "Glossy black latex hood + bodysuit, red lips",
      "Counts wrap the list; extensions continue",
      "Default negative allows adult / X-style content"
    ],
    isPromptList: true,
    nsfw: true
  },
  {
    id: "nyx-domination",
    label: "Nyx domination",
    optionLabel: "Nyx domination (NSFW / X)",
    intro:
      "Nyx domination (NSFW): own femdom shot list — latex Nyx dominating a skinny average young man. Separate from solo latex fetish, choke, and Instagram. Counts wrap the list. Master image stays the identity guide for Nyx.",
    placeholderName: "Nyx domination NSFW dataset",
    characterPlaceholder:
      "Stable Nyx identity (body, latex, lips). Shot list supplies the male sub + poses.",
    defaultBasePrompt:
      "photorealistic adult woman Nyx, voluptuous hourglass figure, glossy black latex, featureless latex hood, large crimson lips, long black ponytail, long red nails",
    negativeProfile: "nsfw-with-male",
    cycleFamily: "domination",
    guidance: [
      "Own femdom collection — separate from solo latex and choke",
      "Kneel · smother · ride · forced oral · embrace · submission",
      "Latex Nyx + skinny average young man (short brown hair)",
      "Counts wrap the list; negative allows male sub",
      "X-style adult content OK"
    ],
    isPromptList: true,
    nsfw: true
  },
  {
    id: "nyx-choke",
    label: "Nyx choke",
    optionLabel: "Nyx choke (NSFW / X)",
    intro:
      "Nyx choke (NSFW): own choke / sleeper / headlock femdom collection. Separate from domination and solo latex. Counts wrap the list. Master image stays the identity guide for Nyx.",
    placeholderName: "Nyx choke NSFW dataset",
    characterPlaceholder:
      "Stable Nyx identity (body, latex, lips, red nails). Shot list supplies choke holds + male sub.",
    defaultBasePrompt:
      "photorealistic adult woman Nyx, voluptuous hourglass figure, glossy black latex bodysuit or catsuit, featureless latex hood, large crimson lips, long black ponytail, long red nails",
    negativeProfile: "nsfw-with-male",
    cycleFamily: "choke",
    guidance: [
      "Own choke collection — not domination-only, not solo latex",
      "Throat grip · sleeper · headlock · ride with choke · oral with choke",
      "Includes close-up variants (snot/drool detail)",
      "Latex Nyx + skinny average young man; negative allows male",
      "X-style adult content OK"
    ],
    isPromptList: true,
    nsfw: true
  }
];

export const DATASET_MODE_CATALOG: DatasetModeCatalogEntry[] = [
  STANDARD_MODE,
  ...LIST_MODE_CATALOG
];

const byId = new Map(DATASET_MODE_CATALOG.map(entry => [entry.id, entry]));

export function getDatasetModeEntry(mode?: string | null): DatasetModeCatalogEntry {
  const id = String(mode || "standard").trim() || "standard";
  if (byId.has(id)) return byId.get(id)!;
  // Unknown list id: treat as generic prompt-list mode (backwards / forward compatible).
  if (id !== "standard") {
    return {
      id,
      label: id,
      optionLabel: id,
      intro: `Prompt-list mode “${id}”: loads data/dataset-prompt-lists/${id}.json when present. Counts wrap any list length. Master image stays the identity guide.`,
      placeholderName: `${id} dataset`,
      characterPlaceholder: "Stable identity only — face, hair, body. Shots come from the list.",
      negativeProfile: id.startsWith("nyx-") ? "nsfw-with-male" : "standard",
      cycleFamily: id.startsWith("nyx-") ? "latex" : "instagram",
      guidance: [
        `JSON list: data/dataset-prompt-lists/${id}.json`,
        "Any prompt count wraps for 12/24/40 builds",
        "Add a catalog entry in dataset-mode-catalog.ts for custom UI copy"
      ],
      isPromptList: true,
      nsfw: id.startsWith("nyx-")
    };
  }
  return STANDARD_MODE;
}

export function listKnownDatasetModes(): DatasetModeCatalogEntry[] {
  return DATASET_MODE_CATALOG.slice();
}

export function cycleNotesForFamily(family: DatasetCycleFamily): [string, string, string] {
  switch (family) {
    case "choke":
      return [
        "",
        "alternate choke pass with mirrored grip and slightly different camera height",
        "third choke pass with changed hand placement and gaze while keeping the same latex and submissive subject"
      ];
    case "domination":
      return [
        "",
        "alternate domination pass with mirrored body orientation and slightly different camera height",
        "third domination pass with changed hand placement and gaze while keeping the same latex and submissive subject"
      ];
    case "latex":
      return [
        "",
        "alternate latex pass with mirrored body orientation and slightly different camera height",
        "third latex pass with changed hand placement and gaze while keeping the same latex look"
      ];
    case "instagram":
      return [
        "",
        "alternate Instagram pass with mirrored body orientation and slightly different camera height",
        "third Instagram pass with changed hand placement and gaze while keeping the same outfit concept"
      ];
    default:
      return ["", "alternate variety pass", "third variety pass"];
  }
}
