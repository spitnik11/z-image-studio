import { describe, expect, it } from "vitest";
import {
  cycleNotesForFamily,
  getDatasetModeEntry,
  listKnownDatasetModes
} from "./dataset-mode-catalog.js";

describe("dataset mode catalog", () => {
  it("lists standard plus known list modes including choke", () => {
    const modes = listKnownDatasetModes();
    const ids = modes.map(m => m.id);
    expect(ids[0]).toBe("standard");
    expect(ids).toContain("instagram-ugc");
    expect(ids).toContain("nyx-latex-fetish");
    expect(ids).toContain("nyx-domination");
    expect(ids).toContain("nyx-choke");
    expect(modes.find(m => m.id === "nyx-choke")?.isPromptList).toBe(true);
    expect(modes.find(m => m.id === "nyx-choke")?.negativeProfile).toBe("nsfw-with-male");
  });

  it("unknown modes still resolve as prompt-list with safe defaults (forward compatible)", () => {
    const entry = getDatasetModeEntry("my-future-set");
    expect(entry.id).toBe("my-future-set");
    expect(entry.isPromptList).toBe(true);
    expect(entry.negativeProfile).toBe("standard");
  });

  it("nyx-* unknown defaults to nsfw-with-male so male partners are not banned", () => {
    const entry = getDatasetModeEntry("nyx-custom-future");
    expect(entry.isPromptList).toBe(true);
    expect(entry.nsfw).toBe(true);
    expect(entry.negativeProfile).toBe("nsfw-with-male");
  });

  it("cycle families return three-pass notes", () => {
    expect(cycleNotesForFamily("choke")[1]).toMatch(/choke pass/i);
    expect(cycleNotesForFamily("domination")[1]).toMatch(/domination pass/i);
    expect(cycleNotesForFamily("latex")[1]).toMatch(/latex pass/i);
    expect(cycleNotesForFamily("instagram")[1]).toMatch(/Instagram pass/i);
  });
});
