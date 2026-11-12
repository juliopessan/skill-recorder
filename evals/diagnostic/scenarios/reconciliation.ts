import { makeAnalysis, makeEngagement, type DiagnosticScenario } from "../scenario";

const EXCEL = "Microsoft Excel";
const OUTLOOK = "Microsoft Outlook";
const ERP = "ERP Protheus";

const session = (id: string, day: number, extra: boolean) =>
  makeAnalysis(id, day, "Conciliação bancária", "Conciliar o extrato bancário com os lançamentos do ERP", [
    { id: "a", title: "Exportou o extrato bancário do ERP", detail: "Abriu o módulo financeiro e exportou o extrato do dia em CSV.", apps: [ERP], from: 0, to: 6 },
    { id: "b", title: "Colou o extrato na planilha de conciliação", detail: "Abriu a planilha mensal e colou o CSV na aba Extrato.", apps: [EXCEL], from: 6, to: 12 },
    { id: "c", title: "Cruzou os lançamentos com PROCV na planilha", detail: "Usou PROCV para cruzar valor e data entre extrato e razão, marcando as linhas sem par.", apps: [EXCEL], from: 12, to: 32 },
    { id: "d", title: "Enviou as divergências por e-mail ao financeiro", detail: "Copiou as linhas sem par e as enviou por e-mail para o time de contas a pagar.", apps: [OUTLOOK, EXCEL], from: 32, to: 40 },
    { id: "e", title: "Lançou os ajustes de conciliação no ERP", detail: extra ? "Registrou manualmente os ajustes aprovados e a baixa dos títulos no ERP." : "Registrou manualmente os ajustes no ERP.", apps: [ERP], from: 40, to: 55 },
  ]);

export const reconciliation: DiagnosticScenario = {
  id: "diagnostic-reconciliation",
  title: "Conciliação bancária (planilha + e-mail + ERP)",
  truth:
    "Três gravações do mesmo processo de conciliação bancária: exportar o extrato do ERP, colar na planilha Excel, cruzar com PROCV, enviar as divergências por e-mail (Outlook) e lançar os ajustes de volta no ERP. Todo o fluxo é manual, com cópia e cola entre sistemas; os dados são planilhas soltas (baixa maturidade de dados).",
  analyses: [session("diag-rec-1", 0, false), session("diag-rec-2", 1, true), session("diag-rec-3", 2, false)],
  engagement: makeEngagement(
    "eng-rec",
    "Distribuidora Aurora",
    "Conciliação bancária",
    "proc-rec",
    ["diag-rec-1", "diag-rec-2", "diag-rec-3"],
    { inventory: 2, structure: 1, quality: 2, access: 2, governance: 1 },
    240,
    3,
  ),
  processId: "proc-rec",
  mapExpect: {
    minSteps: 4,
    maxSteps: 6,
    expectVariants: false,
    keyApps: ["excel", "outlook", "erp"],
    stepKeywords: [["extrato", "exportar"], ["planilha", "procv", "cruzar"], ["e-mail", "email", "divergencia"], ["ajuste", "lancar", "lancamento"]],
  },
  oppExpect: { lowDataScore: true, weakDimensions: ["dados", "processos"] },
  handoffTerms: ["e-mail", "planilha", "extrato"],
};
