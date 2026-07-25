import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { prepareProtectedAcceptance } from "@emsenn/protected-acceptance-service/client";
import { dispatchBatch as defaultDispatch } from "./market-client.mjs";

export const DEFAULT_ACCEPTANCE_SUPPLIER_LOTS = 2;

function inside(root, requested) {
  const path = resolve(root, requested);
  if (path !== resolve(root) && !path.startsWith(`${resolve(root)}${sep}`)) throw new Error(`acceptance procurement path escapes admitted territory: ${requested}`);
  return path;
}

function artifactSchema(artifactPath) {
  return {
    type: "object", required: ["artifact", "rationale"],
    properties: {
      artifact: {
        type: "object", required: ["path", "text"],
        properties: {
          path: { type: "string", const: artifactPath },
          text: { type: "string", minLength: 100, maxLength: 30000 },
        },
        additionalProperties: false,
      },
      rationale: { type: "string", minLength: 20, maxLength: 1000 },
    },
    additionalProperties: false,
  };
}

function validArtifactPath(path) {
  return typeof path === "string" && path.startsWith("union-acceptance/") && path.endsWith(".test.mjs");
}

function supplierJob(input, { artifactPath, packet, id }) {
  return {
    id,
    workType: "software-engineering",
    requiredCapabilities: ["software-engineering", "json-schema-output"],
    difficulty: input.difficulty ?? 0.72,
    maxTokens: input.maxTokens ?? 3600,
    ...(input.routingProfile ? { routingProfile: input.routingProfile } : {}),
    ...(input.extendedRoutingRationale ? { extendedRoutingRationale: input.extendedRoutingRationale } : {}),
    ...(input.considerationPolicy ? { considerationPolicy: input.considerationPolicy } : {}),
    ...(input.supplierExclusions?.length ? { excludeProviders: input.supplierExclusions } : {}),
    messages: [
      { role: "system", content: "You are an acceptance-test supplier, independent from implementation suppliers. Produce the complete protected oracle artifact, not implementation code or commentary." },
      { role: "user", content: JSON.stringify(packet) },
    ],
    outputContract: { format: "json", mode: "json_schema", schema: artifactSchema(artifactPath) },
  };
}

function evidenceFiles(input) {
  const root = resolve(input.territory);
  return [...new Set(input.contextPaths || input.focusPaths || [])].map((requested) => {
    const path = relative(root, inside(root, requested)).split(sep).join("/");
    const text = readFileSync(inside(root, path), "utf8");
    return { path, text };
  });
}

export async function procureAcceptanceCapsule(input, {
  dispatch = defaultDispatch,
  prepareAcceptance = prepareProtectedAcceptance,
  now,
} = {}) {
  const territory = resolve(input.territory), artifactPath = String(input.artifactPath || "");
  const vectorArtifactPaths = input.vectorArtifactPaths && typeof input.vectorArtifactPaths === "object" && !Array.isArray(input.vectorArtifactPaths)
    ? input.vectorArtifactPaths
    : null;
  if (!vectorArtifactPaths && !validArtifactPath(artifactPath)) throw new Error("acceptance procurement requires a union-acceptance/*.test.mjs artifact path");
  if (Array.isArray(input.endpointShards) && input.endpointShards.length) throw new Error("customer-selected acceptance suppliers are retired; declare capability bounds and let the inference-work-lot market select");
  const evidence = evidenceFiles(input);
  const packetBase = {
    type: "AcceptanceSupplierContext",
    objective: input.objective,
    command: input.command,
    constraints: input.constraints || [],
    evidence,
    contract: [
      "Return one complete Node test artifact. Every test vector id must be the exact test name so host TAP output witnesses execution.",
      "Exercise every given/when/then/forbidden clause with concrete assertions. A comment or title alone is not coverage.",
      "The artifact must fail against the supplied incumbent because of behavioral assertions, not syntax, import, fixture, or infrastructure errors.",
      "Use mkdtempSync and test cleanup. Do not use network, child processes, environment variables, dynamic imports, clocks, randomness, timers, or sleeps.",
      "Import implementation APIs using paths relative to the declared artifactPath. Do not alter implementation source.",
    ],
  };
  if (vectorArtifactPaths) {
    const vectors = Array.isArray(input.testVectors) ? input.testVectors : [];
    const vectorIds = vectors.map((vector) => vector?.id);
    if (!vectors.length || Object.keys(vectorArtifactPaths).length !== vectors.length || vectorIds.some((id) => !validArtifactPath(vectorArtifactPaths[id])) || new Set(Object.values(vectorArtifactPaths)).size !== vectors.length) {
      throw new Error("vector-sharded acceptance procurement requires one unique union-acceptance/*.test.mjs path per test vector");
    }
    const jobs = vectors.map((vector, index) => {
      const path = vectorArtifactPaths[vector.id];
      const packet = {
        ...packetBase,
        artifactPath: path,
        testVectors: [vector],
        priorReviewResidue: input.priorReviewResidue?.[vector.id] ?? input.priorReviewResidue ?? null,
        contract: [
          ...packetBase.contract,
          `This shard implements only vector ${vector.id}; its one Node test must use that exact test name.`,
        ],
      };
      return supplierJob(input, { artifactPath: path, packet, id: `${input.id}:acceptance-vector:${vector.id}` });
    });
    const records = await dispatch(jobs, { concurrency: Math.min(jobs.length, Number(input.concurrency) || jobs.length), timeoutMs: input.providerTimeoutMs || 60000 });
    const byId = new Map(records.map((record) => [record.id, record])), artifacts = [], suppliers = [], refusals = [];
    for (let index = 0; index < vectors.length; index += 1) {
      const vector = vectors[index], job = jobs[index], record = byId.get(job.id);
      let supplied;
      try { supplied = record?.text ? JSON.parse(record.text) : null; }
      catch { supplied = null; }
      if (!supplied?.artifact || supplied.artifact.path !== vectorArtifactPaths[vector.id]) {
        refusals.push({ supplierJobId: job.id, endpoint: record?.endpoint || null, reason: record?.refusal?.reason || record?.refusal?.type || "invalid or missing vector artifact" });
        continue;
      }
      artifacts.push(supplied.artifact);
      suppliers.push({ vectorId: vector.id, jobId: record.id, provider: record.provider || null, endpoint: record.endpoint || null, consideration: record.cost || null, rationale: supplied.rationale });
    }
    if (artifacts.length !== vectors.length) {
      const error = new Error(`vector-sharded acceptance procurement left unresolved shards: ${refusals.map((refusal) => `${refusal.supplierJobId}: ${refusal.reason}`).join("; ")}`);
      error.code = "acceptance-supplier-market-exhausted";
      throw error;
    }
    const capsule = await prepareAcceptance({ ...input, territory, artifacts, supplierProviders: suppliers.map(({ provider, endpoint }) => provider || endpoint).filter(Boolean) }, { ...(now ? { now } : {}) });
    return {
      type: "AcceptanceProcurementSettlement",
      id: input.id,
      supplier: { kind: "vector-sharded", jobs: suppliers },
      refusedCandidates: refusals,
      capsule,
      resourceAccount: {
        supplierJobs: jobs.length,
        supplierAttempts: records.reduce((count, candidate) => count + (candidate.attempts?.length || 0), 0),
        usefulSupplierCompletions: records.filter((candidate) => typeof candidate.text === "string").length,
        directInteractiveModelCalls: 0,
        expectedConsideration: records.filter((candidate) => candidate.cost).map((candidate) => ({ provider: candidate.provider || null, consideration: candidate.cost })),
      },
    };
  }
  const packet = { ...packetBase, artifactPath, testVectors: input.testVectors, priorReviewResidue: input.priorReviewResidue || null };
  const supplierLots = Math.max(1, Math.min(Number(input.supplierLots) || DEFAULT_ACCEPTANCE_SUPPLIER_LOTS, 4));
  const jobs = Array.from({ length: supplierLots }, (_, index) => supplierJob(input, { artifactPath, packet, id: `${input.id}:acceptance-supplier:${index + 1}` }));
  const records = await dispatch(jobs, { concurrency: supplierLots, timeoutMs: input.providerTimeoutMs || 60000 });
  const byId = new Map(records.map((record) => [record.id, record])), refusals = [];
  for (const job of jobs) {
    const record = byId.get(job.id);
    let supplied;
    try { supplied = JSON.parse(record?.text); }
    catch { refusals.push({ supplierJobId: record?.id || job.id, endpoint: record?.endpoint || null, reason: record?.refusal?.reason || record?.refusal?.type || "invalid supplier JSON" }); continue; }
    try {
      const capsule = await prepareAcceptance({
        id: input.id,
        objective: input.objective,
        territory,
        focusPaths: input.focusPaths,
        command: input.command,
        constraints: input.constraints || [],
        testVectors: input.testVectors,
        artifacts: [supplied.artifact],
        supplierProviders: [record.provider || record.endpoint].filter(Boolean),
        ...(input.difficulty !== undefined ? { difficulty: input.difficulty } : {}),
        ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
        ...(input.considerationPolicy !== undefined ? { considerationPolicy: input.considerationPolicy } : {}),
        ...(input.routingProfile !== undefined ? { routingProfile: input.routingProfile } : {}),
        ...(input.extendedRoutingRationale !== undefined ? { extendedRoutingRationale: input.extendedRoutingRationale } : {}),
      }, { ...(now ? { now } : {}) });
      return {
        type: "AcceptanceProcurementSettlement",
        id: input.id,
        supplier: { jobId: record.id, provider: record.provider || null, endpoint: record.endpoint || null, consideration: record.cost || null, rationale: supplied.rationale },
        refusedCandidates: refusals,
        capsule,
        resourceAccount: {
          supplierJobs: jobs.length,
          supplierAttempts: records.reduce((count, candidate) => count + (candidate.attempts?.length || 0), 0),
          usefulSupplierCompletions: records.filter((candidate) => typeof candidate.text === "string").length,
          directInteractiveModelCalls: 0,
          expectedConsideration: records.filter((candidate) => candidate.cost).map((candidate) => ({ provider: candidate.provider || null, consideration: candidate.cost })),
        },
      };
    } catch (error) {
      refusals.push({ supplierJobId: record.id, endpoint: record.endpoint || null, reason: error.message });
    }
  }
  const error = new Error(`no acceptance supplier produced a sealable capsule: ${refusals.map((refusal) => `${refusal.endpoint || refusal.supplierJobId}: ${refusal.reason}`).join("; ")}`);
  error.code = "acceptance-supplier-market-exhausted";
  throw error;
}
