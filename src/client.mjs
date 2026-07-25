import { randomUUID } from "node:crypto";
import { Message, Role } from "@a2a-js/sdk";
import { a2aResultParts, sendRmnTask } from "@emsenn/a2a-rmn-task-client-service";
import { extractRmnPart, rmnPart } from "@emsenn/a2a-rmn-part-service";
import { decodeSemantic, semanticBytes, semanticId } from "@emsenn/rmn-semantic-conformance";
import { SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION, circuitInterfaceFromAgentCard } from "@emsenn/rmn-semantic-conformance/hierarchical-circuit";
import { ACCEPTANCE_PROCUREMENT_LAW } from "./law.mjs";
import { decodeReceipt, encodeRequest } from "./protocol.mjs";
const parts = a2aResultParts;
export async function procureSoftwareAcceptanceCapsule(input, { agentCardUrl = process.env.ACCEPTANCE_CAPSULE_PROCUREMENT_AGENT_CARD_URL, signal, send = sendRmnTask } = {}) {
  if (!agentCardUrl) throw new Error("ACCEPTANCE_CAPSULE_PROCUREMENT_AGENT_CARD_URL is required");
  const request = encodeRequest({ kind: "AcceptanceCapsuleProcurementRequest", input });
  const message = Message.toJSON({ messageId: randomUUID(), contextId: "", taskId: "", role: Role.ROLE_USER, parts: [rmnPart(request.bytes, "acceptance-procurement-request.rmn.cbor")], metadata: {}, extensions: [], referenceTaskIds: [] });
  let exchange;
  try {
    exchange = await send({ agentUrl: agentCardUrl, extensions: [SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION], requireSignature: true, message, ...(signal ? { signal } : {}) });
  } catch (error) {
    if (String(error?.message ?? error).includes("acceptance-supplier-market-exhausted")) error.purchasedAttemptSettled = true;
    throw error;
  }
  const output = extractRmnPart(parts(exchange.result)), term = decodeSemantic(output.bytes); if (!semanticBytes(term).equals(output.bytes) || term?.[0] !== "ascribe" || term.length !== 3) throw new Error("acceptance procurement provider returned noncanonical RMN");
  const receipt = decodeReceipt(term[1], term[2]), provider = circuitInterfaceFromAgentCard(exchange.agentCard); if (provider.component.law !== ACCEPTANCE_PROCUREMENT_LAW.id || receipt.provider !== provider.account || receipt.subject !== request.id) throw new Error("acceptance procurement receipt does not bind the contracted face and exact subject");
  return Object.freeze({ ...receipt.settlement, procurementProvider: provider.account, procurementReceiptNi: semanticId(term) });
}
