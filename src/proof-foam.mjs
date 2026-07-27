import { semanticId } from "@emsenn/rmn-semantic-conformance";
import { relationalRwilDocument } from "@emsenn/rwil-rdf-services/client";

export function proofStateIdentity(value) {
  return semanticId(relationalRwilDocument(value));
}

export function supplierDesignId({ subject, lane = "coherent", residue = [] }) {
  const frontier = proofStateIdentity({ type: "AcceptanceSupplierFrontier", subject, lane, residue });
  return `${subject}:acceptance-supplier:design:${frontier.slice("ni:///sha-256;".length)}`;
}

/** Missing Opponent responses and excess Player responses never cancel. */
export function responseConstraintPair({ requiredOpponentMoves, admittedOpponentMoves, playerMoves }) {
  const admitted = new Set(admittedOpponentMoves);
  const required = new Set(requiredOpponentMoves);
  let deficiency = 0n;
  for (const move of required) if (!admitted.has(move)) deficiency += 1n;
  const players = new Set(playerMoves);
  const redundancy = BigInt(players.size) > BigInt(required.size)
    ? BigInt(players.size) - BigInt(required.size)
    : 0n;
  return Object.freeze({
    deficiency: deficiency.toString(),
    redundancy: redundancy.toString(),
  });
}

const DEFAULT_VERIFIER_CLASS = Object.freeze([
  "assay-admitted",
  "assay-refused",
  "assay-obstructed",
]);

function positiveFraction(value, label) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype
      || value.unit !== "millisecond"
      || !/^[1-9][0-9]*$/u.test(value.numerator ?? "")
      || !/^[1-9][0-9]*$/u.test(value.denominator ?? "")) {
    throw new TypeError(`${label} must be one positive exact millisecond fraction`);
  }
  return { numerator: BigInt(value.numerator), denominator: BigInt(value.denominator) };
}

function gcd(left, right) {
  let a = left < 0n ? -left : left, b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function reduced(numerator, denominator) {
  const divisor = gcd(numerator, denominator);
  return Object.freeze({ numerator: (numerator / divisor).toString(), denominator: (denominator / divisor).toString() });
}

/**
 * Dry a proof history relative to one declared verifier class. Provider and
 * author identities are provenance: only a later recomputation/assay visit
 * makes a supplier branch observable. Duplicate Player dispatches and
 * supplier products reached by no verifier are ballast.
 */
export function proofIncarnation(events, { verifierClass = DEFAULT_VERIFIER_CLASS } = {}) {
  if (!Array.isArray(verifierClass) || verifierClass.length === 0
      || verifierClass.some((transition) => typeof transition !== "string" || transition === "")) {
    throw new TypeError("proof incarnation requires one nonempty verifier transition class");
  }
  const verifierTransitions = new Set(verifierClass);
  const visitedCandidates = new Set(events
    .filter(({ transition, candidate }) => verifierTransitions.has(transition) && candidate)
    .map(({ candidate }) => candidate));
  const visitedDesigns = new Set(events
    .filter(({ transition, candidate }) => transition === "supplier-delivered" && visitedCandidates.has(candidate))
    .map(({ design }) => design).filter(Boolean));
  const material = [], ballast = [];
  const seen = new Set();
  for (const event of events) {
    const locus = event.candidate ?? event.design ?? event.transitionKey;
    const visited = (event.candidate && visitedCandidates.has(event.candidate))
      || (event.design && visitedDesigns.has(event.design));
    if (!visited || seen.has(`${event.transition}:${locus}`)) ballast.push(event);
    else { material.push(event); seen.add(`${event.transition}:${locus}`); }
  }
  return Object.freeze({ material: Object.freeze(material), ballast: Object.freeze(ballast) });
}

export function observeProofKinetics(events, { observationWindow } = {}) {
  const demanded = events.find(({ transition, observedAt }) => transition === "supplier-demanded" && observedAt);
  const settled = events.find(({ transition, observedAt }) => DEFAULT_VERIFIER_CLASS.includes(transition) && observedAt);
  if (!demanded || !settled) {
    return Object.freeze({ disposition: "pending", glueTime: null, observationWindow: observationWindow ?? null, proofingDeborah: null });
  }
  const glueMilliseconds = Date.parse(settled.observedAt) - Date.parse(demanded.observedAt);
  if (!Number.isSafeInteger(glueMilliseconds) || glueMilliseconds < 0) throw new TypeError("proof-pore timestamps do not define one monotone exact duration");
  const glueTime = Object.freeze({ numerator: String(glueMilliseconds), denominator: "1", unit: "millisecond" });
  if (observationWindow === undefined) {
    return Object.freeze({ disposition: "unclassified", glueTime, observationWindow: null, proofingDeborah: null });
  }
  const window = positiveFraction(observationWindow, "observationWindow");
  const ratio = reduced(BigInt(glueMilliseconds) * window.denominator, window.numerator);
  return Object.freeze({
    disposition: BigInt(ratio.numerator) <= BigInt(ratio.denominator) ? "permeable" : "kinetic-obstruction",
    glueTime,
    observationWindow: Object.freeze({ ...observationWindow }),
    proofingDeborah: ratio,
  });
}

export function observeProofFoam(events, { verifierClass = DEFAULT_VERIFIER_CLASS, observationWindow } = {}) {
  const demanded = events.filter(({ transition }) => transition === "supplier-demanded");
  const answered = events.filter(({ transition }) => ["supplier-delivered", "supplier-refused"].includes(transition));
  const pair = responseConstraintPair({
    requiredOpponentMoves: demanded.map(({ design }) => design),
    admittedOpponentMoves: answered.map(({ design }) => design),
    playerMoves: demanded.map(({ transitionKey }) => transitionKey),
  });
  const incarnation = proofIncarnation(events, { verifierClass });
  return Object.freeze({
    type: "AcceptanceProofFoamObservation",
    verifierClass: Object.freeze([...verifierClass]),
    responseConstraints: pair,
    materialEventCount: String(incarnation.material.length),
    ballastEventCount: String(incarnation.ballast.length),
    incarnation,
    kinetics: observeProofKinetics(events, { observationWindow }),
  });
}
