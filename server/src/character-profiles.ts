import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { writeJsonAtomic } from "./file-utils.js";

export const characterProfileSchema = z.object({
  name: z.string().trim().min(1).max(100),
  triggerToken: z.string().trim().min(1).max(100),
  masterReferenceImages: z.array(z.string().max(500)).max(8).default([]),
  stableIdentity: z.string().max(2000).default(""),
  hairstyle: z.string().max(300).default(""),
  eyeColor: z.string().max(100).default(""),
  bodyCharacteristics: z.string().max(1000).default(""),
  defaultOutfit: z.string().max(1000).default(""),
  changeableAttributes: z.array(z.string().max(100)).max(20).default([]),
  notes: z.string().max(3000).default(""),
  preferredModel: z.string().max(300).default(""),
  identityWeight: z.number().min(0).max(2).default(0.7)
});

export type CharacterProfile = z.infer<typeof characterProfileSchema> & {
  id: string; createdAt: string; updatedAt: string;
};

export class CharacterProfileStore {
  constructor(private readonly file: string) {}
  list(): CharacterProfile[] { return this.load().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  get(id: string) { return this.load().find(item => item.id === id); }
  create(raw: unknown) {
    const data = characterProfileSchema.parse(raw);
    const now = new Date().toISOString();
    const profile: CharacterProfile = { ...data, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    this.save([profile, ...this.load()]);
    return profile;
  }
  update(id: string, raw: unknown) {
    const records = this.load();
    const index = records.findIndex(item => item.id === id);
    if (index < 0) return undefined;
    const data = characterProfileSchema.parse(raw);
    records[index] = { ...records[index], ...data, updatedAt: new Date().toISOString() };
    this.save(records);
    return records[index];
  }
  remove(id: string) {
    const records = this.load();
    const next = records.filter(item => item.id !== id);
    if (next.length === records.length) return false;
    this.save(next); return true;
  }
  private load(): CharacterProfile[] {
    try { return JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { return []; }
  }
  private save(records: CharacterProfile[]) {
    writeJsonAtomic(this.file, records);
  }
}
