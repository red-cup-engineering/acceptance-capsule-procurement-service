import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { prepareProtectedAcceptance } from "@red-cup-engineering/protected-acceptance-service/client";
import { dispatchBatch as defaultDispatch } from "./market-client.mjs";

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
          text: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      rationale: { type: "string", minLength: 1 },
    },
    additionalProperties: false,
  };
}

function validArtifactPath(path) {
  return typeof path === "string" && path.startsWith("union-acceptance/") && path.endsWith(".test.mjs");
}

function projectSupplierRecord(text) {
  const source = String(text ?? "");
  const candidates = [...source.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)].map((match) => match[1]);
  candidates.push(source.trim());
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch { /* Continue to the next deterministic carrier. */ }
  }
  return null;
}

function supplierJob(input, { artifactPath, packet, id }) {
  return {
    id,
    workType: "software-engineering",
    requiredCapabilities: ["software-engineering"],
    difficulty: input.difficulty ?? 0.72,
    ...(input.routingProfile ? { routingProfile: input.routingProfile } : {}),
    ...(input.extendedRoutingRationale ? { extendedRoutingRationale: input.extendedRoutingRationale } : {}),
    ...(input.considerationPolicy ? { considerationPolicy: input.considerationPolicy } : {}),
    ...(input.supplierExclusions?.length ? { excludeProviders: input.supplierExclusions } : {}),
    messages: [
      { role: "system", content: "You supply an executable acceptance-test artifact. Reason freely, then conclude with one fenced JSON record containing artifact and rationale. Only the host-executed artifact can establish acceptance." },
      { role: "user", content: JSON.stringify(packet) },
    ],
    outputContract: { format: "text" },
    customerProjection: { type: "fenced-json-acceptance-artifact", schema: artifactSchema(artifactPath) },
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
    const records = await dispatch(jobs);
    const byId = new Map(records.map((record) => [record.id, record])), artifacts = [], suppliers = [], refusals = [];
    for (let index = 0; index < vectors.length; index += 1) {
      const vector = vectors[index], job = jobs[index], record = byId.get(job.id);
      let supplied;
      supplied = projectSupplierRecord(record?.text);
      if (!supplied?.artifact || supplied.artifact.path !== vectorArtifactPaths[vector.id]) {
        refusals.push({ supplierJobId: job.id, endpoint: record?.endpoint || null, reason: record?.refusal?.reason || record?.refusal?.type || "invalid or missing vector artifact" });
        continue;
      }
      artifacts.push(supplied.artifact);
      suppliers.push({ vectorId: vector.id, jobId: record.id, provider: record.provider || null, endpoint: record.endpoint || null, consideration: record.cost || null, rationale: supplied.rationale });
    }
    if (artifacts.length !== vectors.length) throw new Error(`vector-sharded acceptance procurement left unresolved shards: ${refusals.map((refusal) => `${refusal.supplierJobId}: ${refusal.reason}`).join("; ")}`);
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
  const jobs = [supplierJob(input, { artifactPath, packet, id: `${input.id}:acceptance-artifact` })];
  const records = await dispatch(jobs);
  const byId = new Map(records.map((record) => [record.id, record])), refusals = [];
  for (const job of jobs) {
    const record = byId.get(job.id);
    let supplied;
    supplied = projectSupplierRecord(record?.text);
    if (!supplied) { refusals.push({ supplierJobId: record?.id || job.id, endpoint: record?.endpoint || null, reason: record?.refusal?.reason || record?.refusal?.type || "missing projected acceptance artifact" }); continue; }
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
  throw new Error(`no acceptance supplier produced a sealable capsule: ${refusals.map((refusal) => `${refusal.endpoint || refusal.supplierJobId}: ${refusal.reason}`).join("; ")}`);
}
