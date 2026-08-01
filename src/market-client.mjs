import { requestInferenceWorkBatch } from "@harmonious-union/inference-work-lot-service/client";

const ACTOR = "urn:ame:acceptance-capsule-procurement-service";

function marketUrl(value) {
  const source = value ?? process.env.INFERENCE_WORK_LOT_AGENT_CARD_URL;
  if (typeof source !== "string" || !/^https?:\/\//u.test(source)) throw new Error("INFERENCE_WORK_LOT_AGENT_CARD_URL is required");
  return source;
}

export async function dispatchBatch(jobs, options = {}) {
  return requestInferenceWorkBatch(jobs, {
    ...options,
    agentUrl: marketUrl(options.marketAgentUrl),
    customer: ACTOR,
    purpose: "Produce one attributable acceptance-oracle proposal with exact replay evidence; do not implement customer software or claim the distinct customer-acceptance judgment.",
    desiredUse: "Submit one advisory oracle artifact to the separately owned protected-acceptance assay.",
    workLotPrefix: "acceptance-capsule",
  });
}

export const fabricDefaults = Object.freeze({
  customer: ACTOR,
  market: "urn:ame:inference-work-lot-service",
  selectionOwner: "urn:ame:inference-work-lot-service",
  acceptanceOwner: ACTOR,
  carrier: ["signed A2A 1.0 Agent Card", "canonical RMN/CBOR", "witness-journal RDF"],
});
