import { readFileSync } from "node:fs";
import { compileRmlLaw } from "@red-cup-engineering/rmn-semantic-conformance/law";
export const ACCEPTANCE_PROCUREMENT_LAW = compileRmlLaw(readFileSync(new URL("../content/contracts/procure-acceptance-capsule.rml", import.meta.url), "utf8"));
