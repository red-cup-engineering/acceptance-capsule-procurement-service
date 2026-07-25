import { readFileSync } from "node:fs";
import { compileRmlLaw } from "@emsenn/rmn-semantic-conformance/law";
export const ACCEPTANCE_PROCUREMENT_LAW = compileRmlLaw(readFileSync(new URL("../content/contracts/procure-acceptance-capsule.rml", import.meta.url), "utf8"));
