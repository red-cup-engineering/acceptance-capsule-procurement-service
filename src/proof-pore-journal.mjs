import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { identify } from "./semantic-content.mjs";

const NI = /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u;

function plain(value, label) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be one plain object`);
  }
  return value;
}

function eventIdentity(body) {
  return identify(body, "acceptance-capsule-procurement.proof-pore-event").id;
}

function subjectFileName(subject) {
  return `${createHash("sha256").update(subject).digest("base64url")}.jsonl`;
}

function parseJournal(path, subject) {
  if (!existsSync(path)) return [];
  const events = readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  let previous = null;
  for (const [sequence, event] of events.entries()) {
    plain(event, `proof-pore event ${sequence}`);
    const { id, ...body } = event;
    if (!NI.test(id ?? "") || id !== eventIdentity(body)) throw new Error(`proof-pore event ${sequence} identity drift`);
    if (body.subject !== subject) throw new Error(`proof-pore event ${sequence} belongs to a foreign subject`);
    if (body.sequence !== sequence) throw new Error(`proof-pore event ${sequence} sequence drift`);
    if (body.previous !== previous) throw new Error(`proof-pore event ${sequence} predecessor drift`);
    previous = id;
  }
  return events;
}

/**
 * Provider-local write head for kinetic proof pores.
 *
 * This extracts the gaming dialogue log, fabrication-run predecessor chain,
 * and scheduled-delivery fsync discipline.  WitnessJournal projection is downstream of
 * this journal: a projection obstruction can never erase or reopen a pore.
 */
export function createProofPoreJournal({ root, now = () => new Date().toISOString() } = {}) {
  if (typeof root !== "string" || root.length === 0) throw new TypeError("proof-pore journal root is required");
  const directory = resolve(root, "proof-pores");
  mkdirSync(directory, { recursive: true });

  function pathFor(subject) {
    if (typeof subject !== "string" || subject.length === 0) throw new TypeError("proof-pore subject is required");
    return join(directory, subjectFileName(subject));
  }

  function read(subject) {
    return Object.freeze(parseJournal(pathFor(subject), subject));
  }

  function append(subject, transition) {
    plain(transition, "proof-pore transition");
    if (typeof transition.transitionKey !== "string" || transition.transitionKey.length === 0) {
      throw new TypeError("proof-pore transitionKey is required");
    }
    const path = pathFor(subject), prior = parseJournal(path, subject);
    const existing = prior.find((event) => event.transitionKey === transition.transitionKey);
    if (existing) {
      const existingTransition = Object.fromEntries(Object.entries(existing)
        .filter(([key]) => !["id", "subject", "sequence", "previous", "observedAt"].includes(key)));
      if (JSON.stringify(existingTransition) !== JSON.stringify(transition)) {
        throw new Error(`proof-pore transition ${transition.transitionKey} was already pinned with different material`);
      }
      return existing;
    }
    const body = {
      subject,
      sequence: prior.length,
      previous: prior.at(-1)?.id ?? null,
      observedAt: now(),
      ...transition,
    };
    const event = Object.freeze({ id: eventIdentity(body), ...body });
    const fd = openSync(path, "a", 0o600);
    try {
      writeSync(fd, `${JSON.stringify(event)}\n`, null, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return event;
  }

  return Object.freeze({ root: directory, read, append });
}
