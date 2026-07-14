import { createHash } from 'crypto';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import initDatabase from '../src/db/sqlite.js';
import { EmbeddingService } from '../src/embedding/service.js';
import {
  E5_LARGE_USAGE_PROFILE,
  E5_SMALL_USAGE_PROFILE,
  type EmbeddingUsageProfile,
} from '../src/embedding/profiles.js';
import { serializeAssertionPassage, serializeEntityPassage } from '../src/embedding/serialization.js';
import { DEFAULT_RETRIEVAL_CONFIG } from '../src/retrieval/config.js';
import { reciprocalRankFuse } from '../src/retrieval/fusion.js';
import { decodeEmbedding } from '../src/utils/math.js';
import type { Assertion, Entity } from '../src/shared-types.js';

type Kind = 'entity' | 'assertion';
type Candidate = {
  id: string;
  kind: Kind;
  text: string;
  goldTurnIds: string[];
  sourceSpan?: string;
};
type RankedCandidate = Candidate & {
  score: number;
  sources: Array<{ source: string; rawRank: number; rawDistance: number | null; normalizedScore: number; weight: number }>;
};

const K_LIST = [1, 3, 5, 10, 20] as const;
const TOP_K = 20;
const PER_SOURCE_POOL = 40;
const CATEGORY_NAMES: Record<number, string> = {
  1: 'single_hop', 2: 'temporal', 3: 'multi_hop', 4: 'open_domain', 5: 'adversarial',
};

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${item} requires a value`);
    result[item.slice(2)] = value;
    index++;
  }
  return result;
}

function required(args: Record<string, string>, name: string): string {
  const value = String(args[name] || '').trim();
  if (!value) throw new Error(`--${name} is required`);
  return path.resolve(value);
}

function normalize(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function matchScore(spanText: string, turnText: string): number {
  const span = normalize(spanText);
  const turn = normalize(turnText);
  if (!span || !turn) return 0;
  if (span.length >= 8 && (span.includes(turn) || turn.includes(span))) return 1;
  const a = new Set(span.split(' ').filter((word) => word.length > 2));
  const b = new Set(turn.split(' ').filter((word) => word.length > 2));
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((word) => b.has(word)).length;
  return overlap / (a.size + b.size - overlap);
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))].toFixed(2));
}

function dot(left: number[], right: number[]): number {
  let value = 0;
  for (let index = 0; index < left.length; index++) value += left[index] * right[index];
  return value;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function sha256File(filePath: string): Promise<string> {
  return sha256(await readFile(filePath));
}

function parseJson(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, any>;
  try { return JSON.parse(String(value)); } catch { return {}; }
}

function legacyEntityText(entity: Entity): string {
  return `${entity.name}: ${entity.description || ''}`;
}

function legacyAssertionText(assertion: Assertion): string {
  return [
    `subjectId:${assertion.subject_id}`,
    `predicate:${assertion.predicate}`,
    assertion.object_id ? `objectId:${assertion.object_id}` : '',
    assertion.literal_value ? `literalValue:${assertion.literal_value}` : '',
  ].filter(Boolean).join(', ');
}

async function embedCorpus(
  label: string,
  service: EmbeddingService,
  candidates: Candidate[],
): Promise<Array<Candidate & { vector: number[] }>> {
  const output: Array<Candidate & { vector: number[] }> = [];
  for (let index = 0; index < candidates.length; index++) {
    const result = await service.embedPassage(candidates[index].text);
    output.push({ ...candidates[index], vector: result.embedding });
    if ((index + 1) % 50 === 0 || index + 1 === candidates.length) {
      process.stdout.write(`${JSON.stringify({ event: 'ablation_embedding_progress', label, completed: index + 1, total: candidates.length })}\n`);
    }
  }
  return output;
}

function rank(
  queryVector: number[],
  corpus: Array<Candidate & { vector: number[] }>,
  limit = PER_SOURCE_POOL,
): RankedCandidate[] {
  return corpus.map((candidate) => ({
    ...candidate,
    score: dot(queryVector, candidate.vector),
    sources: [],
  })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}

function attachLegacyAssertions(
  rankedEntities: RankedCandidate[],
  assertionsBySubject: Map<string, Candidate[]>,
): RankedCandidate[] {
  const attached: RankedCandidate[] = [];
  for (const entity of rankedEntities.slice(0, 10)) {
    for (const assertion of (assertionsBySubject.get(entity.id) || []).slice(0, 8)) {
      attached.push({
        ...assertion,
        score: entity.score,
        sources: [{ source: 'subject_attachment', rawRank: attached.length + 1, rawDistance: null, normalizedScore: entity.score, weight: 1 }],
      });
      if (attached.length >= 30) return attached;
    }
  }
  return attached;
}

function fuse(entityRank: RankedCandidate[], assertionRank: RankedCandidate[]): RankedCandidate[] {
  return reciprocalRankFuse<Candidate>([
    {
      source: 'entity_vector',
      weight: DEFAULT_RETRIEVAL_CONFIG.entityVectorWeight,
      items: entityRank.map((candidate) => ({ id: candidate.id, kind: 'entity', value: candidate, score: candidate.score })),
    },
    {
      source: 'assertion_vector',
      weight: DEFAULT_RETRIEVAL_CONFIG.assertionVectorWeight,
      items: assertionRank.map((candidate) => ({ id: candidate.id, kind: 'assertion', value: candidate, score: candidate.score })),
    },
  ], { rrfK: DEFAULT_RETRIEVAL_CONFIG.rrfK }).map((candidate) => ({
    ...candidate.value,
    score: candidate.fusedScore,
    sources: candidate.sources,
  }));
}

function evaluateQuestion(gold: string[], candidates: RankedCandidate[], finalContext: RankedCandidate[]) {
  const goldSet = new Set(gold);
  const covered = (items: RankedCandidate[]) => new Set(items.flatMap((item) => item.goldTurnIds.filter((id) => goldSet.has(id))));
  const result: any = { recallAny: {}, recallFull: {} };
  for (const k of K_LIST) {
    const coverage = covered(candidates.slice(0, k));
    result.recallAny[k] = coverage.size > 0 ? 1 : 0;
    result.recallFull[k] = coverage.size === goldSet.size ? 1 : 0;
  }
  const firstRank = candidates.findIndex((candidate) => candidate.goldTurnIds.some((id) => goldSet.has(id)));
  result.mrr10 = firstRank >= 0 && firstRank < 10 ? 1 / (firstRank + 1) : 0;
  let dcg = 0;
  candidates.slice(0, 10).forEach((candidate, index) => {
    if (candidate.goldTurnIds.some((id) => goldSet.has(id))) dcg += 1 / Math.log2(index + 2);
  });
  let idcg = 0;
  for (let index = 0; index < Math.min(goldSet.size, 10); index++) idcg += 1 / Math.log2(index + 2);
  result.ndcg10 = idcg ? Math.min(1, dcg / idcg) : 0;
  result.candidateRecall = covered(candidates.slice(0, PER_SOURCE_POOL)).size > 0 ? 1 : 0;
  result.finalContextRecall = covered(finalContext).size > 0 ? 1 : 0;
  result.assertionRecall = covered(candidates.filter((item) => item.kind === 'assertion').slice(0, 10)).size > 0 ? 1 : 0;
  result.entityRecall = covered(candidates.filter((item) => item.kind === 'entity').slice(0, 10)).size > 0 ? 1 : 0;
  result.coveredGold = [...covered(finalContext)];
  return result;
}

function aggregate(records: any[]) {
  const output: any = { n: records.length, recallAny: {}, recallFull: {} };
  for (const k of K_LIST) {
    output.recallAny[k] = Number((records.reduce((sum, row) => sum + row.metrics.recallAny[k], 0) / records.length).toFixed(4));
    output.recallFull[k] = Number((records.reduce((sum, row) => sum + row.metrics.recallFull[k], 0) / records.length).toFixed(4));
  }
  for (const key of ['mrr10', 'ndcg10', 'candidateRecall', 'finalContextRecall', 'assertionRecall', 'entityRecall']) {
    output[key] = Number((records.reduce((sum, row) => sum + row.metrics[key], 0) / records.length).toFixed(4));
  }
  output.retrievalLatencyMs = {
    p50: percentile(records.map((row) => row.retrievalLatencyMs), 0.5),
    p95: percentile(records.map((row) => row.retrievalLatencyMs), 0.95),
  };
  return output;
}

async function main(): Promise<void> {
  process.env.OMNI_EVALUATION_MODE = '1';
  process.env.TRANSFORMERS_OFFLINE = '1';
  const args = parseArgs(process.argv.slice(2));
  const dbPath = required(args, 'db');
  const sourceDbPath = required(args, 'source-db');
  const datasetPath = required(args, 'dataset');
  const v1ResultsPath = required(args, 'v1-results');
  const outputDir = required(args, 'output');
  const smallModelRoot = required(args, 'small-model-root');
  const largeModelRoot = required(args, 'large-model-root');
  await mkdir(outputDir, { recursive: true });

  const loaderPath = path.resolve(process.cwd(), '../benchmark/src/dataset.mjs');
  const { loadLoCoMoConversation } = await import(pathToFileURL(loaderPath).href);
  const conversation = await loadLoCoMoConversation(datasetPath, 1);
  const turns = new Map<string, string>();
  for (const [key, value] of Object.entries(conversation.conversation)) {
    if (!/^session_\d+$/.test(key) || !Array.isArray(value)) continue;
    for (const turn of value as any[]) turns.set(String(turn.dia_id), String(turn.text || ''));
  }
  const questions = conversation.qa.map((item: any, index: number) => ({
    id: `conv1-q${index}`,
    index,
    question: String(item.question),
    category: CATEGORY_NAMES[Number(item.category)] || String(item.category),
    categoryId: Number(item.category),
    gold: (item.evidence || []).map(String),
  })).filter((item: any) => item.categoryId !== 5 && item.gold.length > 0);

  const db = initDatabase({ dbPath });
  await db.runMigrations();
  const entityRows = await db.all<any>(
    `SELECT * FROM entities WHERE COALESCE(json_extract(metadata, '$.merged_into'), '') = '' ORDER BY id`,
  );
  const entities: Entity[] = entityRows.map((row) => ({
    ...row,
    description: row.description || '',
    tags: row.tags ? JSON.parse(row.tags) : [],
    metadata: parseJson(row.metadata),
    embedding: row.embedding ? decodeEmbedding(row.embedding) : undefined,
  }));
  const assertions = await db.getAssertions({ includeHistorical: true, limit: 1000 });
  if (assertions.length === 1000) throw new Error('Assertion cap reached; refusing a truncated ablation corpus');
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));

  const assertionTurnIds = new Map<string, string[]>();
  for (const assertion of assertions) {
    const matches = [...turns.entries()]
      .map(([id, text]) => ({ id, score: matchScore(assertion.source_span || '', text) }))
      .filter((item) => item.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.id);
    assertionTurnIds.set(assertion.id, matches);
  }
  const entityTurnIds = new Map<string, Set<string>>();
  for (const assertion of assertions) {
    for (const id of [assertion.subject_id, assertion.object_id].filter(Boolean) as string[]) {
      const set = entityTurnIds.get(id) || new Set<string>();
      for (const turnId of assertionTurnIds.get(assertion.id) || []) set.add(turnId);
      entityTurnIds.set(id, set);
    }
  }

  const entityLegacy: Candidate[] = entities.map((entity) => ({
    id: entity.id, kind: 'entity', text: legacyEntityText(entity), goldTurnIds: [...(entityTurnIds.get(entity.id) || [])],
  }));
  const entityReadable: Candidate[] = entities.map((entity) => ({
    id: entity.id, kind: 'entity', text: serializeEntityPassage(entity), goldTurnIds: [...(entityTurnIds.get(entity.id) || [])],
  }));
  const assertionLegacy: Candidate[] = assertions.map((assertion) => ({
    id: assertion.id, kind: 'assertion', text: legacyAssertionText(assertion),
    goldTurnIds: assertionTurnIds.get(assertion.id) || [], sourceSpan: assertion.source_span,
  }));
  const assertionReadable: Candidate[] = assertions.map((assertion) => ({
    id: assertion.id,
    kind: 'assertion',
    text: serializeAssertionPassage({
      assertion,
      subjectName: entityById.get(assertion.subject_id)?.name || assertion.subject_id,
      objectName: assertion.object_id ? entityById.get(assertion.object_id)?.name : undefined,
    }),
    goldTurnIds: assertionTurnIds.get(assertion.id) || [],
    sourceSpan: assertion.source_span,
  }));
  const assertionBySubject = new Map<string, Candidate[]>();
  for (const candidate of assertionReadable) {
    const assertion = assertions.find((item) => item.id === candidate.id)!;
    const list = assertionBySubject.get(assertion.subject_id) || [];
    list.push(candidate);
    assertionBySubject.set(assertion.subject_id, list);
  }

  const noPrefixProfile: EmbeddingUsageProfile = {
    ...E5_SMALL_USAGE_PROFILE,
    queryPrefix: '', passagePrefix: '',
    serializationVersion: 'candidate-v1-entity-name-description',
    usageProfileVersion: 'candidate-v1-no-prefix',
  };
  const smallNoPrefix = new EmbeddingService({
    mode: 'local', localModel: E5_SMALL_USAGE_PROFILE.modelId, localModelPath: smallModelRoot,
    dimensions: 384, usageProfile: noPrefixProfile, failOnUnavailable: true,
  });
  const smallPrefixed = new EmbeddingService({
    mode: 'local', localModel: E5_SMALL_USAGE_PROFILE.modelId, localModelPath: smallModelRoot,
    dimensions: 384, failOnUnavailable: true,
  });
  const large = new EmbeddingService({
    mode: 'local', localModel: E5_LARGE_USAGE_PROFILE.modelId, localModelPath: largeModelRoot,
    dimensions: 1024, failOnUnavailable: true,
  });

  const loadStarted: Record<string, number> = {};
  const loadMs: Record<string, number> = {};
  loadStarted.a = Date.now();
  await smallNoPrefix.embedQuery('preflight');
  loadMs.a = Date.now() - loadStarted.a;
  loadStarted.b = Date.now();
  await smallPrefixed.embedQuery('preflight');
  loadMs.b = Date.now() - loadStarted.b;
  const storedV1Entities = entityLegacy.map((candidate, index) => {
    const vector = entities[index].embedding;
    if (!vector || vector.length !== 384) throw new Error(`Candidate v1 entity vector missing or wrong dimension: ${candidate.id}`);
    return { ...candidate, vector };
  });
  const smallPrefixedEntities = await embedCorpus('B-small-prefixed-entity-legacy', smallPrefixed, entityLegacy);

  loadStarted.large = Date.now();
  await large.embedQuery('preflight');
  loadMs.large = Date.now() - loadStarted.large;
  const largeLegacyEntities = await embedCorpus('C-large-entity-legacy', large, entityLegacy);
  const largeLegacyAssertions = await embedCorpus('D-large-assertion-legacy', large, assertionLegacy);
  const largeReadableEntities = await embedCorpus('F-large-entity-readable', large, entityReadable);
  const largeReadableAssertions = await embedCorpus('F-large-assertion-readable', large, assertionReadable);

  const variants = [
    { id: 'A', label: 'candidate-v1-small-no-prefix-entity-only', service: smallNoPrefix, entity: storedV1Entities, assertion: null, mode: 'entity' },
    { id: 'B', label: 'small-prefix-entity-only', service: smallPrefixed, entity: smallPrefixedEntities, assertion: null, mode: 'entity' },
    { id: 'C', label: 'large-prefix-entity-only', service: large, entity: largeLegacyEntities, assertion: null, mode: 'entity' },
    { id: 'D', label: 'large-prefix-assertion-only', service: large, entity: null, assertion: largeLegacyAssertions, mode: 'assertion' },
    { id: 'E', label: 'large-prefix-parallel-legacy-serialization', service: large, entity: largeLegacyEntities, assertion: largeLegacyAssertions, mode: 'parallel' },
    { id: 'F', label: 'large-prefix-parallel-readable-serialization', service: large, entity: largeReadableEntities, assertion: largeReadableAssertions, mode: 'parallel' },
  ] as const;

  const perQuestion: any[] = [];
  for (const variant of variants) {
    for (const question of questions) {
      const started = performance.now();
      const queryVector = (await variant.service.embedQuery(question.question)).embedding;
      const entityRank = variant.entity ? rank(queryVector, variant.entity) : [];
      const assertionRank = variant.assertion ? rank(queryVector, variant.assertion) : [];
      const candidates = variant.mode === 'parallel' ? fuse(entityRank, assertionRank)
        : variant.mode === 'assertion' ? assertionRank : entityRank;
      const finalContext = variant.mode === 'entity'
        ? attachLegacyAssertions(entityRank, assertionBySubject)
        : candidates.filter((candidate) => candidate.kind === 'assertion').slice(0, TOP_K);
      const retrievalLatencyMs = performance.now() - started;
      perQuestion.push({
        variant: variant.id,
        label: variant.label,
        questionId: question.id,
        category: question.category,
        gold: question.gold,
        retrievalLatencyMs: Number(retrievalLatencyMs.toFixed(2)),
        metrics: evaluateQuestion(question.gold, candidates, finalContext),
        candidates: candidates.slice(0, TOP_K).map((candidate, index) => ({
          id: candidate.id, type: candidate.kind, rank: index + 1,
          score: Number(candidate.score.toFixed(8)), sources: candidate.sources,
          matchedGold: candidate.goldTurnIds.filter((id) => question.gold.includes(id)),
        })),
        finalContext: finalContext.map((candidate, index) => ({
          id: candidate.id, type: candidate.kind, rank: index + 1,
          sourceSpan: candidate.sourceSpan || null,
          matchedGold: candidate.goldTurnIds.filter((id) => question.gold.includes(id)),
        })),
      });
    }
  }

  const summary: any = {};
  for (const variant of variants) {
    const records = perQuestion.filter((row) => row.variant === variant.id);
    summary[variant.id] = {
      label: variant.label,
      all: aggregate(records),
      categories: Object.fromEntries([...new Set(records.map((row) => row.category))].map((category) => [
        category, aggregate(records.filter((row) => row.category === category)),
      ])),
    };
  }
  const config = {
    conversationIds: [1],
    topK: TOP_K,
    perSourcePool: PER_SOURCE_POOL,
    fusion: {
      method: 'weighted_rrf', rrfK: DEFAULT_RETRIEVAL_CONFIG.rrfK,
      entityVectorWeight: DEFAULT_RETRIEVAL_CONFIG.entityVectorWeight,
      assertionVectorWeight: DEFAULT_RETRIEVAL_CONFIG.assertionVectorWeight,
    },
    matching: 'normalized-substring-or-token-jaccard-0.5',
    entitySerialization: 'entity-passage-v2',
    assertionSerialization: 'assertion-passage-v1',
  };
  const v1Lines = (await readFile(v1ResultsPath, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
  const v1ByQuestion = new Map<string, any>();
  for (const line of v1Lines) {
    const row = JSON.parse(line);
    if (row.status === 'completed') v1ByQuestion.set(String(row.question_id), row);
  }
  const v1FormalRows = questions.map((question: any) => {
    const row = v1ByQuestion.get(question.id);
    const spans = (row?.evidence || [])
      .filter((evidence: any) => evidence.type === 'assertion' && evidence.source_span)
      .map((evidence: any) => String(evidence.source_span));
    const coveredGold = question.gold.filter((id: string) => {
      const turn = turns.get(id);
      return Boolean(turn && spans.some((span: string) => matchScore(span, turn) >= 0.5));
    });
    return {
      category: question.category,
      finalContextPresent: coveredGold.length > 0 ? 1 : 0,
      answerCorrect: Number(row?.metrics?.binary_accuracy || 0),
    };
  });
  const summarizeV1 = (rows: typeof v1FormalRows) => {
    const present = rows.filter((row) => row.finalContextPresent === 1);
    return {
      n: rows.length,
      finalContextRecall: Number((rows.reduce((sum, row) => sum + row.finalContextPresent, 0) / rows.length).toFixed(4)),
      goldEvidencePresentCount: present.length,
      goldEvidencePresentAccuracy: present.length
        ? Number((present.reduce((sum, row) => sum + row.answerCorrect, 0) / present.length).toFixed(4))
        : 0,
    };
  };
  const report = {
    status: 'complete',
    createdAt: new Date().toISOString(),
    input: {
      dbPath, dbSha256: await sha256File(dbPath), dbBytes: (await stat(dbPath)).size,
      candidateV1SourceDbPath: sourceDbPath,
      candidateV1SourceDbSha256: await sha256File(sourceDbPath),
      datasetPath,
      conversation1ContentSha256: sha256(JSON.stringify(conversation)),
      v1ResultsPath, v1ResultRows: v1Lines.length,
      conversationIds: [1], entities: entities.length, assertions: assertions.length, questions: questions.length,
    },
    profiles: {
      candidateV1: smallNoPrefix.getUsageProfile(),
      smallPrefixed: smallPrefixed.getUsageProfile(),
      large: large.getUsageProfile(),
    },
    modelLoadMs: loadMs,
    peakRssBytes: process.memoryUsage().rss,
    config,
    configHash: sha256(JSON.stringify(config)),
    candidateV1FormalProxy: {
      all: summarizeV1(v1FormalRows),
      categories: Object.fromEntries([...new Set(v1FormalRows.map((row) => row.category))].map((category) => [
        category, summarizeV1(v1FormalRows.filter((row) => row.category === category)),
      ])),
    },
    summary,
  };
  await writeFile(path.join(outputDir, 'retrieval-ablation-summary.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(outputDir, 'retrieval-ablation-per-question.jsonl'), `${perQuestion.map((row) => JSON.stringify(row)).join('\n')}\n`);
  await db.close();
  process.stdout.write(`${JSON.stringify({ event: 'retrieval_ablation_complete', outputDir, summary })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ event: 'retrieval_ablation_failed', error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
