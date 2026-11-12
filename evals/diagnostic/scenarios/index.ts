import type { DiagnosticScenario } from "../scenario";
import { onboarding } from "./onboarding";
import { reconciliation } from "./reconciliation";

export const diagnosticScenarios: DiagnosticScenario[] = [reconciliation, onboarding];
