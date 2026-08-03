import { procureAcceptanceCapsule } from "./procurement.mjs";
import { admit, identify } from "./semantic-content.mjs";
export const PROFILE = "org.emsenn.software.acceptance-capsule-procurement.v1";
export const PROVIDER_ACCOUNT = "eip155:31337:0x03871dcf70060da9799a5ea105761e455441a9d0";
const REQUEST_KIND = "acceptance-capsule-procurement.request";
const RECEIPT_KIND = "acceptance-capsule-procurement.receipt";
function exactKeys(value, keys) { return value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0"); }
export function normalizeRequest(value) { if (!exactKeys(value, ["input", "kind"]) || value.kind !== "AcceptanceCapsuleProcurementRequest" || !value.input || Object.getPrototypeOf(value.input) !== Object.prototype) throw new Error("acceptance procurement request has an unknown, absent, or legacy field"); return value; }
export function encodeRequest(value) { return identify(normalizeRequest(value), REQUEST_KIND); }
export function decodeRequest(bytes) { return normalizeRequest(admit(bytes, REQUEST_KIND)); }
export async function performRequest(value, options = {}) { const request = normalizeRequest(value), subject = identify(request, REQUEST_KIND).id, settlement = await procureAcceptanceCapsule(request.input, options); const receipt = { kind: "AcceptanceCapsuleProcurementReceipt", profile: PROFILE, provider: PROVIDER_ACCOUNT, subject, settlement }; const document = identify(receipt, RECEIPT_KIND); return { receipt, semanticId: document.id, canonicalBytes: document.bytes }; }
export function decodeReceipt(bytes) { const value = admit(bytes, RECEIPT_KIND); if (!exactKeys(value, ["kind", "profile", "provider", "settlement", "subject"]) || value.kind !== "AcceptanceCapsuleProcurementReceipt" || value.profile !== PROFILE || value.provider !== PROVIDER_ACCOUNT) throw new Error("acceptance procurement receipt is malformed or foreign"); return value; }
export function receiptIdentity(value) { return identify(value, RECEIPT_KIND).id; }
