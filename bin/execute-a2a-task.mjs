#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Message, Role } from "@a2a-js/sdk";
import { extractRmnPart, rmnPart } from "@emsenn/a2a-rmn-part-service";
import { decodeSemantic, semanticBytes } from "@emsenn/rmn-semantic-conformance";
import { createSettlementStore } from "@emsenn/rwil-rdf-services/client";
import { ACCEPTANCE_PROCUREMENT_LAW } from "../src/law.mjs";
import { decodeRequest, performRequest } from "../src/protocol.mjs";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export async function executeA2aMessage(source, env = process.env, options = {}) { const message = Message.fromJSON(source); if (message.role !== Role.ROLE_USER) throw new Error("acceptance procurement requires an A2A ROLE_USER message"); if (!env.RWIL_RDF_AGENT) throw new Error("RWIL_RDF_AGENT is required"); const input = extractRmnPart(message.parts), term = decodeSemantic(input.bytes); if (!semanticBytes(term).equals(input.bytes) || term?.[0] !== "ascribe" || term.length !== 3) throw new Error("acceptance procurement request must be canonical typed RMN CBOR"); const result = await performRequest(decodeRequest(term[1], term[2]), options), recordedAt = new Date().toISOString(); await createSettlementStore({ settlementRoot: ROOT, dataRoot: resolve(ROOT, "data"), agentUrl: env.RWIL_RDF_AGENT }).record({ category: "acceptance-capsule-procurement.receipt", recordedAt, record: { ...result.receipt, semanticId: result.semanticId, law: ACCEPTANCE_PROCUREMENT_LAW.id } }); return Message.toJSON({ messageId: randomUUID(), contextId: message.contextId, taskId: message.taskId, role: Role.ROLE_AGENT, parts: [rmnPart(result.canonicalBytes, "acceptance-procurement-receipt.rmn.cbor")], metadata: { receiptNi: result.semanticId, law: ACCEPTANCE_PROCUREMENT_LAW.id }, extensions: [], referenceTaskIds: [] }); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) try { process.stdout.write(`${JSON.stringify(await executeA2aMessage(JSON.parse(readFileSync(0, "utf8"))))}\n`); } catch (error) { process.stderr.write(`${error.code ?? "acceptance-procurement-refusal"}: ${error.message}\n`); process.exitCode = 1; }
