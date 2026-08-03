import { randomUUID } from "node:crypto";
import { Message, Role } from "@a2a-js/sdk";
import { a2aResultParts, sendRmnTask } from "@red-cup-engineering/a2a-rmn-task-client-service";
import { extractRmnPart, rmnPart } from "@red-cup-engineering/a2a-rmn-part-service";
import { decodeReceipt, encodeRequest, receiptIdentity } from "./protocol.mjs";
import { SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION, providerAccountFromAgentCard } from "./sovereign-provider.mjs";
const parts = a2aResultParts;
export async function procureSoftwareAcceptanceCapsule(input, { agentCardUrl = process.env.ACCEPTANCE_CAPSULE_PROCUREMENT_AGENT_CARD_URL, signal, send = sendRmnTask } = {}) {
  if (!agentCardUrl) throw new Error("ACCEPTANCE_CAPSULE_PROCUREMENT_AGENT_CARD_URL is required");
  const request = encodeRequest({ kind: "AcceptanceCapsuleProcurementRequest", input });
  const message = Message.toJSON({ messageId: randomUUID(), contextId: "", taskId: "", role: Role.ROLE_USER, parts: [rmnPart(request.bytes, "acceptance-procurement-request.rmn.cbor")], metadata: {}, extensions: [], referenceTaskIds: [] });
  const exchange = await send({ agentUrl: agentCardUrl, extensions: [SOVEREIGN_CIRCUIT_INTERFACE_EXTENSION], requireSignature: true, message, ...(signal ? { signal } : {}) });
  const output = extractRmnPart(parts(exchange.result));
  const receipt = decodeReceipt(output.bytes), provider = providerAccountFromAgentCard(exchange.agentCard); if (receipt.provider !== provider || receipt.subject !== request.id) throw new Error("acceptance procurement receipt does not bind the contracted face and exact subject");
  return Object.freeze({ ...receipt.settlement, procurementProvider: provider, procurementReceiptNi: receiptIdentity(receipt) });
}
