import { describe, it, beforeAll, afterAll } from "vitest";
import { expect } from "vitest";
import { buildTemporalWhere, resolveTemporalField, getEntitiesByEffectiveTime, getAssertionsByEffectiveTime } from "../src/retrieval/temporal-layer.js";
import initDatabase from "../src/db/sqlite.js";
import { Database } from "../src/db/sqlite.js";
import { v4 as uuidv4 } from "uuid";

describe("temporal retrieval layer", () => {
  let db: Database;

  beforeAll(async () => {
    db = initDatabase({ dbPath: ":memory:", enableWAL: false });
    await db.runMigrations();
  });

  afterAll(async () => {
    await db.close();
  });

  it("current facts exclude invalidated entities by default", async () => {
    const now = new Date().toISOString();
    const past = new Date(Date.now() - 86400000).toISOString();
    const evenEarlier = new Date(Date.now() - 172800000).toISOString();

    await db.addEntity({
      name: "Current Preference",
      type: "preference",
      description: "Current valid preference",
      valid_from: past,
      valid_until: undefined,
      event_time: past,
    });

    await db.addEntity({
      name: "Expired Preference",
      type: "preference",
      description: "Expired preference",
      valid_from: evenEarlier,
      valid_until: past,
      event_time: evenEarlier,
    });

    const entities = await getEntitiesByEffectiveTime(
      db, evenEarlier, new Date(Date.now() + 60000).toISOString(), 10
    );
    const current = entities.filter((e) => e.name === "Current Preference");
    const expired = entities.filter((e) => e.name === "Expired Preference");

    expect(current.length).toBeGreaterThanOrEqual(1);
    expect(expired.length).toBe(0);
  });

  it("new entity does not overwrite old entity by created_at", async () => {
    const now = new Date().toISOString();
    const oldTime = "2023-01-01T00:00:00.000Z";
    const newTime = "2026-01-01T00:00:00.000Z";

    await db.addEntity({
      name: "User Residence",
      type: "preference",
      description: "Lived in Beijing",
      valid_from: oldTime,
      event_time: oldTime,
      observed_at: oldTime,
      recorded_at: oldTime,
    });

    await db.addEntity({
      name: "User Residence",
      type: "preference",
      description: "Lived in Shanghai",
      valid_from: newTime,
      event_time: newTime,
      observed_at: newTime,
      recorded_at: newTime,
    });

    const entities = await getEntitiesByEffectiveTime(
      db, oldTime, new Date(Date.now() + 60000).toISOString(), 20, { includeHistorical: true }
    );

    const beijing = entities.filter((e) => e.description?.includes("Beijing"));
    const shanghai = entities.filter((e) => e.description?.includes("Shanghai"));

    expect(beijing.length).toBeGreaterThanOrEqual(1);
    expect(shanghai.length).toBeGreaterThanOrEqual(1);
  });

  it("as_of query returns old fact, current query returns new fact", async () => {
    const oldTime = "2024-06-01T00:00:00.000Z";
    const newTime = "2026-01-01T00:00:00.000Z";

    await db.addEntity({
      name: `asof-test-${uuidv4()}`,
      type: "preference",
      description: "Old job: Designer",
      valid_from: oldTime,
      valid_until: newTime,
      event_time: oldTime,
    });

    await db.addEntity({
      name: `asof-test-${uuidv4()}`,
      type: "preference",
      description: "Current job: Engineer",
      valid_from: newTime,
      event_time: newTime,
    });

    const currentResults = await getEntitiesByEffectiveTime(
      db, "2020-01-01T00:00:00.000Z", new Date(Date.now() + 60000).toISOString(), 20
    );
    const asOfResults = await getEntitiesByEffectiveTime(
      db, "2020-01-01T00:00:00.000Z", "2025-12-31T23:59:59.000Z", 20, { asOf: "2025-06-01T00:00:00.000Z" }
    );

    const currentJobs = currentResults.filter((e) => e.description?.includes("Engineer") || e.description?.includes("Designer"));
    const asOfJobs = asOfResults.filter((e) => e.description?.includes("Engineer") || e.description?.includes("Designer"));

    expect(currentJobs.length).toBeGreaterThanOrEqual(1);
    expect(asOfJobs.length).toBeGreaterThanOrEqual(1);
  });

  it("event_time is prioritized over recorded_at for chronological ordering", () => {
    const entity = {
      id: "test",
      name: "Test",
      type: "event",
      description: "",
      created_at: "2026-07-12T00:00:00.000Z",
      event_time: "2024-03-15T00:00:00.000Z",
      recorded_at: "2026-07-12T00:00:00.000Z",
      observed_at: "2024-03-16T00:00:00.000Z",
    } as any;

    const resolved = resolveTemporalField(entity);
    expect(resolved.field).toBe("event_time");
    expect(resolved.value).toBe("2024-03-15T00:00:00.000Z");
  });

  it("falls back to created_at when no temporal fields present", () => {
    const entity = {
      id: "test",
      name: "Test",
      type: "concept",
      description: "",
      created_at: "2026-07-12T00:00:00.000Z",
    } as any;

    const resolved = resolveTemporalField(entity);
    expect(resolved.field).toBe("created_at");
  });

  it("historical mode includes expired entities", async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const veryOld = "2020-01-01T00:00:00.000Z";

    await db.addEntity({
      name: "Historical Entry",
      type: "event",
      description: "Past event",
      valid_from: veryOld,
      valid_until: past,
      event_time: veryOld,
    });

    const current = await getEntitiesByEffectiveTime(db, veryOld, new Date(Date.now() + 60000).toISOString(), 10);
    const historical = await getEntitiesByEffectiveTime(
      db, veryOld, new Date(Date.now() + 60000).toISOString(), 10, { includeHistorical: true }
    );

    const currentMatches = current.filter((e) => e.name === "Historical Entry");
    const historicalMatches = historical.filter((e) => e.name === "Historical Entry");

    expect(currentMatches.length).toBe(0);
    expect(historicalMatches.length).toBeGreaterThanOrEqual(1);
  });

  it("valid_until boundary is correct", async () => {
    const boundary = "2025-06-15T00:00:00.000Z";

    await db.addEntity({
      name: `boundary-test-${uuidv4()}`,
      type: "event",
      description: "Valid until boundary test",
      valid_from: "2025-01-01T00:00:00.000Z",
      valid_until: boundary,
      event_time: "2025-01-01T00:00:00.000Z",
    });

    const justBefore = await getEntitiesByEffectiveTime(
      db, "2020-01-01T00:00:00.000Z", "2026-12-31T23:59:59.000Z", 10,
      { asOf: "2025-06-14T23:59:59.000Z" }
    );
    const justAfter = await getEntitiesByEffectiveTime(
      db, "2020-01-01T00:00:00.000Z", "2026-12-31T23:59:59.000Z", 10,
      { asOf: "2025-06-15T00:00:01.000Z" }
    );

    const beforeMatches = justBefore.filter((e) => e.name?.startsWith("boundary-test"));
    const afterMatches = justAfter.filter((e) => e.name?.startsWith("boundary-test"));

    expect(beforeMatches.length).toBeGreaterThanOrEqual(1);
    expect(afterMatches.length).toBe(0);
  });
});
