#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Message, Role } from "@a2a-js/sdk";
import { extractRmnPart, rmnPart } from "@red-cup-engineering/a2a-rmn-part-service";
import { createSettlementStore } from "@lenticule-science/witness-journal-rdf-projection-service/client";
import { decodeRequest, performRequest } from "../src/protocol.mjs";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export async function executeA2aMessage(source, env = process.env, options = {}) { const message = Message.fromJSON(source); if (message.role !== Role.ROLE_USER) throw new Error("acceptance procurement requires an A2A ROLE_USER message"); if (!env.WITNESS_JOURNAL_RDF_AGENT) throw new Error("WITNESS_JOURNAL_RDF_AGENT is required"); const input = extractRmnPart(message.parts); const result = await performRequest(decodeRequest(input.bytes), options), recordedAt = new Date().toISOString(); await createSettlementStore({ settlementRoot: ROOT, agentUrl: env.WITNESS_JOURNAL_RDF_AGENT }).record({ category: "acceptance-capsule-procurement.receipt", recordedAt, record: { ...result.receipt, semanticId: result.semanticId } }); return Message.toJSON({ messageId: randomUUID(), contextId: message.contextId, taskId: message.taskId, role: Role.ROLE_AGENT, parts: [rmnPart(result.canonicalBytes, "acceptance-procurement-receipt.rmn.cbor")], metadata: { receiptNi: result.semanticId }, extensions: [], referenceTaskIds: [] }); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) try { process.stdout.write(`${JSON.stringify(await executeA2aMessage(JSON.parse(readFileSync(0, "utf8"))))}\n`); } catch (error) { process.stderr.write(`${error.code ?? "acceptance-procurement-refusal"}: ${error.message}\n`); process.exitCode = 1; }
