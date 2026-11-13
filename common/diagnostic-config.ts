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

/** Maximum people in a squad: per opportunity and per wave (distinct roles). */
export const MAX_SQUAD_SIZE = 5;

/** Upper bound for a weekly squad rate and for the enablement day rate (guards against overflow). */
export const MAX_RATE = 1_000_000;

/** Weeks in a month (52 / 12): converts squad weeks into delivery months. */
export const WEEKS_PER_MONTH = 52 / 12;

/** Horizon of the return calculation, and the payback shown as "> 36 meses" beyond it. */
export const PAYBACK_DISPLAY_CAP_MONTHS = 36;

/** AI maturity levels; `min` is the inclusive lower bound of the AI readiness score. */
export const MATURITY_LEVELS = [
  { level: 1, name: "Inicial", min: 0 },
  { level: 2, name: "Exploratório", min: 20 },
  { level: 3, name: "Estruturado", min: 40 },
  { level: 4, name: "Escalável", min: 60 },
  { level: 5, name: "Nativo em IA", min: 80 },
] as const;
