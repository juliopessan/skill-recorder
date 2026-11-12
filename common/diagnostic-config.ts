/** Versioned, deterministic knobs for the AI Readiness Diagnostic math. */
export const DIAGNOSTIC_CONFIG_VERSION = 1;

export const DIAGNOSTIC_CONFIG = {
  /** Maximum share of a step's monthly cost that a wave may claim as savings. */
  waveCaps: { 1: 0.3, 2: 0.6, 3: 0.8 },
  /** Data score = questionnaire * 0.6 + observed structured ratio * 0.4. */
  dataWeights: { questionnaire: 0.6, observed: 0.4 },
  /** AI readiness = min * 0.7 + mean * 0.3. */
  aiWeights: { min: 0.7, mean: 0.3 },
  /** Process score penalties (points off 100). */
  processPenalties: {
    perVariant: 5,
    manualTransferRatio: 30,
    reworkRatio: 20,
    unownedRatio: 15,
  },
} as const;

export const DEFAULT_THESIS_TEXT =
  "Antes de adotar IA, é preciso ter os processos mapeados e os dados estruturados. " +
  "Automatizar um processo mal definido ou alimentado por dados desorganizados apenas acelera o caos. " +
  "Este diagnóstico mede a maturidade de processos e de dados da organização e prioriza as oportunidades " +
  "em ondas, começando pelo que já pode ser entregue hoje e preparando o terreno para o restante.";
