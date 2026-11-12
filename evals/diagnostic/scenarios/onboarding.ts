import { makeAnalysis, makeEngagement, type DiagnosticScenario } from "../scenario";

const OUTLOOK = "Microsoft Outlook";
const PORTAL = "Portal do Cliente";
const CRM = "CRM Salesforce";
const EXCEL = "Microsoft Excel";

const viaEmail = makeAnalysis("diag-onb-1", 0, "Onboarding por e-mail", "Cadastrar e dar boas-vindas a um novo cliente", [
  { id: "a", title: "Recebeu a solicitação de cadastro por e-mail", detail: "Leu o e-mail do cliente com os documentos anexados.", apps: [OUTLOOK], from: 0, to: 5 },
  { id: "b", title: "Conferiu os documentos anexos", detail: "Abriu o contrato social e o cartão CNPJ e conferiu os dados manualmente.", apps: [OUTLOOK], from: 5, to: 15 },
  { id: "c", title: "Digitou os dados do cliente no CRM", detail: "Criou o cadastro no CRM copiando razão social, CNPJ e contatos do e-mail.", apps: [CRM], from: 15, to: 30 },
  { id: "d", title: "Atualizou a planilha de acompanhamento", detail: "Registrou o novo cliente na planilha de onboarding.", apps: [EXCEL], from: 30, to: 35 },
  { id: "e", title: "Enviou o e-mail de boas-vindas", detail: "Respondeu ao cliente com o e-mail de boas-vindas e os próximos passos.", apps: [OUTLOOK], from: 35, to: 42 },
]);

const viaPortal = makeAnalysis("diag-onb-2", 1, "Onboarding pelo portal", "Cadastrar e dar boas-vindas a um novo cliente", [
  { id: "a", title: "Abriu a solicitação de cadastro no portal", detail: "Entrou na fila de novos clientes do portal e abriu a solicitação.", apps: [PORTAL], from: 0, to: 4 },
  { id: "b", title: "Validou os documentos enviados no portal", detail: "Conferiu os documentos já anexados ao formulário do portal.", apps: [PORTAL], from: 4, to: 10 },
  { id: "c", title: "Criou o cadastro do cliente no CRM", detail: "Criou o cadastro no CRM a partir dos campos do portal.", apps: [CRM, PORTAL], from: 10, to: 20 },
  { id: "d", title: "Atualizou a planilha de acompanhamento", detail: "Registrou o novo cliente na planilha de onboarding.", apps: [EXCEL], from: 20, to: 24 },
  { id: "e", title: "Enviou o e-mail de boas-vindas", detail: "Enviou o e-mail de boas-vindas com os próximos passos.", apps: [OUTLOOK], from: 24, to: 29 },
]);

export const onboarding: DiagnosticScenario = {
  id: "diagnostic-onboarding",
  title: "Onboarding de clientes (variante e-mail x portal)",
  truth:
    "Duas gravações do onboarding de clientes que divergem na entrada: uma chega por e-mail com documentos anexos (conferência manual e digitação no CRM) e outra chega pelo portal do cliente (documentos já no formulário). Depois as duas convergem: atualizar a planilha de acompanhamento e enviar o e-mail de boas-vindas. O mapa deve unir as etapas equivalentes e registrar a variante de entrada.",
  analyses: [viaEmail, viaPortal],
  engagement: makeEngagement(
    "eng-onb",
    "Grupo Horizonte Serviços",
    "Onboarding de clientes",
    "proc-onb",
    ["diag-onb-1", "diag-onb-2"],
    { inventory: 2, structure: 2, quality: 2, access: 3, governance: 2 },
    60,
    4,
  ),
  processId: "proc-onb",
  mapExpect: {
    minSteps: 4,
    maxSteps: 7,
    expectVariants: true,
    keyApps: ["outlook", "portal", "crm"],
    stepKeywords: [["solicitacao", "cadastro", "receb"], ["documento"], ["crm"], ["boas-vindas", "boas vindas"]],
  },
  oppExpect: { lowDataScore: true, weakDimensions: ["dados", "processos"] },
  handoffTerms: ["e-mail", "portal", "planilha"],
};
