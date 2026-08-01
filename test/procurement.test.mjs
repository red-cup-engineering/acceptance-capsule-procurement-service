import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { resolutionCreditPolicy } from "@red-cup-engineering/inference-work-lot-service/consideration";
import { DEFAULT_ACCEPTANCE_SUPPLIER_LOTS, procureAcceptanceCapsule } from "../src/procurement.mjs";
import { prepareAcceptanceCapsule } from "../../protected-acceptance-service/src/acceptance-capsule.mjs";

test("acceptance procurement opens competing market lots and refuses customer-selected suppliers", async () => {
  assert.equal(DEFAULT_ACCEPTANCE_SUPPLIER_LOTS, 2);
  await assert.rejects(procureAcceptanceCapsule({
    id: "urn:test:pinned-supplier", objective: "must not preselect a provider before market comparison", territory: process.cwd(),
    focusPaths: ["src/acceptance-procurement.mjs"], contextPaths: ["src/acceptance-procurement.mjs"],
    artifactPath: "union-acceptance/pinned.test.mjs", command: "node --test union-acceptance/pinned.test.mjs",
    testVectors: [{ id: "market-routing", given: ["an open provider market"], when: "a supplier is purchased", then: ["the market chooses"] }],
    endpointShards: ["claude-code-claude-sonnet-4-6"],
  }, { dispatch: async () => { throw new Error("must not dispatch"); } }), /customer-selected acceptance suppliers are retired/);
});

test("acceptance procurement carries an explicit extended market profile without selecting a provider", async () => {
  const territory = mkdtempSync(join(tmpdir(), "union-acceptance-extended-test-"));
  writeFileSync(join(territory, "calc.mjs"), "export const add = (a, b) => a - b;\n");
  let jobs;
  await assert.rejects(procureAcceptanceCapsule({
    id: "urn:test:acceptance-extended", objective: "Procure a larger bounded oracle.", territory,
    focusPaths: ["calc.mjs"], contextPaths: ["calc.mjs"],
    artifactPath: "union-acceptance/extended.test.mjs",
    command: "node --test union-acceptance/extended.test.mjs",
    testVectors: [{ id: "extended-routing", given: ["a finite larger oracle"], when: "the market is contracted", then: ["the explicit profile is preserved"] }],
    routingProfile: "extended",
    extendedRoutingRationale: "Four related behavioral vectors require one coherent executable oracle.",
  }, {
    dispatch: async (suppliedJobs) => {
      jobs = suppliedJobs;
      return suppliedJobs.map((job) => ({ id: job.id, refusal: { type: "market-residue", reason: "diagnostic refusal detail" } }));
    },
  }), /diagnostic refusal detail/u);
  assert.ok(jobs.every((job) => job.routingProfile === "extended"));
  assert.ok(jobs.every((job) => job.extendedRoutingRationale.includes("coherent executable oracle")));
  assert.ok(jobs.every((job) => job.excludeProviders === undefined));
});

test("competing supplier output must become red, reviewed, and content-addressed before settlement", async () => {
  const territory = mkdtempSync(join(tmpdir(), "union-acceptance-procurement-test-"));
  writeFileSync(join(territory, "calc.mjs"), "export const add = (a, b) => a - b;\n");
  let jobs, reviewedCandidate;
  const artifact = {
    path: "union-acceptance/addition.test.mjs",
    text: 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../calc.mjs";\ntest("addition-vector", () => assert.equal(add(2, 3), 5));\n',
  };
  const dispatch = async (suppliedJobs) => {
    jobs = suppliedJobs;
    return suppliedJobs.map((job, index) => index === 0
      ? { id: job.id, provider: "urn:ame:supplier-one", endpoint: "supplier-one", text: JSON.stringify({ artifact, rationale: "Exercise addition behavior from exact declared inputs." }), attempts: [{}] }
      : { id: job.id, endpoint: "supplier-two", refusal: { type: "not-needed" }, attempts: [{}] });
  };
  const settlement = await procureAcceptanceCapsule({
    id: "urn:test:acceptance-procurement:addition", objective: "Protect addition behavior.", territory,
    focusPaths: ["calc.mjs"], contextPaths: ["calc.mjs"], artifactPath: artifact.path,
    command: "node --test union-acceptance/addition.test.mjs",
    testVectors: [{ id: "addition-vector", given: ["two and three"], when: "add runs", then: ["five"], forbidden: ["subtraction"] }],
    considerationPolicy: resolutionCreditPolicy(8),
  }, { dispatch, prepareAcceptance: (input) => prepareAcceptanceCapsule(input, { reviewOracle: async ({ oracle, manifest }) => { reviewedCandidate = { candidate: oracle, manifest }; return { accepted: true }; }, now: () => "2026-07-19T00:00:00.000Z" }) });

  assert.equal(settlement.supplier.endpoint, "supplier-one");
  assert.equal(settlement.capsule.redWitness.passed, false);
  assert.match(settlement.capsule.digest, /^ni:\/\/\/sha-256;/);
  assert.equal(settlement.resourceAccount.directInteractiveModelCalls, 0);
  assert.deepEqual(reviewedCandidate.candidate.providers, ["urn:ame:supplier-one"]);
  assert.equal(reviewedCandidate.manifest.considerationPolicy.acceptableAlternatives[0].obligations[0].maximumAmount, 8);
  assert.ok(jobs.every((job) => job.considerationPolicy.acceptableAlternatives[0].obligations[0].maximumAmount === 8));
  assert.ok(jobs.every((job) => job.outputContract.mode === "json_schema"));
  assert.ok(jobs.every((job) => job.messages[1].content.includes("export const add")));
});

test("vector-sharded procurement aggregates attributable replayable free artifacts into one capsule", async () => {
  const territory = mkdtempSync(join(tmpdir(), "union-acceptance-shards-test-"));
  writeFileSync(join(territory, "calc.mjs"), "export const add = (a, b) => a - b;\nexport const multiply = (a, b) => a + b;\n");
  const vectors = [
    { id: "addition-vector", given: ["two and three"], when: "add runs", then: ["five"] },
    { id: "multiplication-vector", given: ["two and three"], when: "multiply runs", then: ["six"] },
  ];
  const paths = Object.fromEntries(vectors.map((vector) => [vector.id, `union-acceptance/${vector.id}.test.mjs`]));
  const texts = {
    "addition-vector": 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../calc.mjs";\ntest("addition-vector", () => assert.equal(add(2, 3), 5));\n',
    "multiplication-vector": 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { multiply } from "../calc.mjs";\ntest("multiplication-vector", () => assert.equal(multiply(2, 3), 6));\n',
  };
  let jobs;
  const settlement = await procureAcceptanceCapsule({
    id: "urn:test:acceptance-procurement:shards", objective: "Protect two arithmetic behaviors.", territory,
    focusPaths: ["calc.mjs"], contextPaths: ["calc.mjs"], vectorArtifactPaths: paths,
    command: `node --test ${Object.values(paths).join(" ")}`, testVectors: vectors,
  }, {
    dispatch: async (suppliedJobs) => {
      jobs = suppliedJobs;
      return suppliedJobs.map((job) => {
        const vectorId = job.id.split(":").at(-1);
        return { id: job.id, provider: `urn:ame:${vectorId}-supplier`, endpoint: `${vectorId}-supplier`, text: JSON.stringify({ artifact: { path: paths[vectorId], text: texts[vectorId] }, rationale: `Exercise ${vectorId} from its exact declared inputs.` }), attempts: [{}] };
      });
    },
    prepareAcceptance: (input) => prepareAcceptanceCapsule(input, { reviewOracle: async () => ({ accepted: true }) }),
  });

  assert.equal(jobs.length, 2);
  assert.ok(jobs.every((job) => job.preferEndpoints === undefined));
  assert.ok(jobs.every((job) => job.workType === "software-engineering"));
  assert.equal(settlement.supplier.kind, "vector-sharded");
  assert.equal(settlement.capsule.artifacts.length, 2);
  assert.deepEqual(new Set(settlement.capsule.redWitness.executedVectorIds), new Set(vectors.map((vector) => vector.id)));
});

test("selected supplier refusals remain in one fixed competition without replacement lots", async () => {
  const territory = mkdtempSync(join(tmpdir(), "union-acceptance-frontier-test-"));
  writeFileSync(join(territory, "calc.mjs"), "export const add = (a, b) => a - b;\n");
  const seen = [];
  await assert.rejects(procureAcceptanceCapsule({
    id: "urn:test:acceptance-frontier", objective: "Traverse distinct supplier capacity.", territory,
    focusPaths: ["calc.mjs"], contextPaths: ["calc.mjs"], artifactPath: "union-acceptance/frontier.test.mjs",
    command: "node --test union-acceptance/frontier.test.mjs", supplierLots: 2,
    testVectors: [{ id: "supplier-frontier", given: ["one refused provider"], when: "the next lot clears", then: ["the refused provider is excluded"] }],
  }, { dispatch: async (jobs) => { seen.push(jobs); return jobs.map((job, index) => ({ id: job.id, attempts: [{ provider: `urn:ame:dead-edge-${index}` }], refusal: { type: "selected-provider-refused" } })); } }), /no acceptance supplier/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].length, 2);
  assert.ok(seen[0].every((job) => job.excludeProviders === undefined));
});
