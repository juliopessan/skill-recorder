# Diagnóstico de Prontidão para IA — Design

Data: 2026-11-12 · Status: aguardando revisão

## 1. Contexto e tese

Clientes chegam dizendo "queremos colocar IA". A tese é dar dois passos atrás:
antes da IA, **os processos estão mapeados?** e **os dados têm qualidade e
estrutura?** O diagnóstico responde isso com evidência observada (gravações do
Skill Recorder) e vira a porta de entrada de uma **esteira de FDE** (Forward
Deployed Engineering) de até 12 meses no cliente, em que a IA entra por último.

Fases do negócio:
- **Fase 1 (este spec):** validar com uso por consultoria (FDE grava processos
  do cliente) e uso interno (time do cliente grava). Entregável: relatório.
- **Fase 2:** esteira de FDE, telemetria de resultado, venda de squads.
- **Fase 3:** produto multi-empresa (fora de escopo).

Sub-projetos (cada um com spec → plano → implementação próprios):
1. **Mapa de processo + baseline de custo + relatório de diagnóstico** ← este spec
2. Motor de oportunidades avançado / proposta comercial
3. Telemetria de resultado (OpenTelemetry, custo de LLM, antes × depois)
4. Esteira de FDE (workflow operacional)

Neste spec, uma versão inicial do motor de oportunidades (item 2) está incluída
porque o relatório precisa dela.

## 2. Objetivo e critérios de sucesso

Um FDE consegue, dentro do Skill Recorder e localmente:
1. Criar um engagement por cliente, cadastrar processos e vincular 1–N
   gravações analisadas a cada processo.
2. Aplicar um questionário de prontidão de dados (com respostas sugeridas a
   partir das gravações).
3. Gerar um mapa consolidado por processo com tempo medido por etapa.
4. Completar o baseline de custo (volume, pessoas, papel) com sugestões da IA
   que precisam de confirmação.
5. Gerar oportunidades em 3 ondas (dados → automação → IA) com pré-requisitos.
6. Exportar um relatório HTML/PDF auditável, em que todo número tem origem
   rastreável (medido / sugerido pela IA / confirmado).

## 3. Abordagem

Novo módulo **Diagnóstico** dentro do app Electron existente, reaproveitando
captura, importação, transcrição, pipeline de análise via Copilot CLI,
revisão de dados sensíveis e persistência local. Alternativas descartadas:
ferramenta separada (duplica UX/análise agora) e skill de agente puro (sem
custo estruturado nem relatório consistente).

## 4. Modelo de dados

Schemas Zod em `common/diagnostic.ts`. Persistência em
`userData/engagements/<engagementId>/` com escrita atômica (tmp + rename),
seguindo `electron/recorder/session-store.ts`.

- **Engagement:** `id`, `clientName`, `createdAt`, `currency` (padrão `BRL`),
  `roles[] {id, name, hourlyCost}`, `dataQuestionnaire`, `processes[]`.
- **Process:** `id`, `name`, `owner`, `sessionIds[]`, `roleId`,
  `volumePerMonth`, `peopleCount`. Cada valor numérico de baseline é um
  `SourcedValue { value, source: "measured" | "ai-suggested" | "confirmed" }`.
- **ProcessMap** (por processo, versionado por `revision`):
  `steps[] { id, title, medianDurationMs, apps[], dataArtifacts[],
  dataStructure: "structured" | "semi" | "unstructured", manualTransfer,
  rework, owner?, sourceStepRefs[] {sessionId, stepId} }`,
  `variants[]` (pontos de divergência entre execuções), `confidence`.
  Durações vêm de `startMs/endMs` dos `AnalysisStep` existentes.
- **DataQuestionnaire:** 5 eixos — inventário, estrutura, qualidade,
  acesso/integração, governança/LGPD — cada um com `answer: 1..4`,
  `source`, `evidence[]`.
- **Opportunity:** `id`, `title`, `processId`, `stepIds[]`, `wave: 1|2|3`,
  `prerequisites[]` (ids), `estimatedSavingsPct` (sourced), `effort: S|M|L`,
  `risk: low|medium|high`, `rationale`, `suggestedSquad {roles[], weeks}`.
  Campos calculados (não persistidos como verdade da IA):
  `monthlyCostToday`, `monthlySavings`, `readinessScore`.
- **DiagnosticReport:** snapshot versionado com scores, oportunidades
  ordenadas, roadmap e flag `draft`.

## 5. Fluxo

Nova aba **Diagnósticos** ao lado de Sessões.

1. Criar engagement (cliente, moeda, papéis e custo/hora).
2. Criar processos; gravar/importar com o fluxo atual; vincular sessões com
   análise aprovada (meta: 2–5 por processo).
3. Questionário de dados: app sugere respostas a partir das gravações
   (ex.: proporção de etapas em planilha/e-mail → eixo Estrutura); FDE confirma.
4. Gerar mapa: novo turno Copilot CLI consolida N análises num `ProcessMap`
   via tool `submit_process_map`; revisão por feedback em linguagem natural,
   como na análise atual.
5. Baseline: FDE preenche/confirma volume, pessoas e papel.
6. Oportunidades: turno de IA (`submit_opportunities`) classifica ondas,
   pré-requisitos, esforço e risco; código calcula custos, economia e scores.
7. Relatório: FDE oculta/reordena oportunidades e exporta HTML/PDF.

Regras de bloqueio:
- Sem baseline confirmado em todos os processos incluídos → relatório sai com
  marca **"Rascunho — premissas não confirmadas"**.
- Oportunidade da onda 3 com pré-requisito de dados não resolvido nunca é
  apresentada como quick win; aparece com o caminho de pré-requisitos.

Privacidade: o relatório usa apenas dados derivados (etapas, tempos, sistemas).
Nenhum frame/screenshot entra por padrão. A revisão de dados sensíveis
existente continua aplicada às sessões.

## 6. Relatório

HTML autocontido + PDF (renderização via Chromium do Electron,
`webContents.printToPDF`).

1. Capa + resumo executivo: 3 scores, custo mensal mapeado, economia
   potencial, top 3 recomendações.
2. "Antes da IA": texto da tese, editável via template.
3. Mapa por processo: fluxo SVG gerado em código com tempo medido, sistemas,
   cor por estrutura de dado, transferências manuais e variações.
4. Diagnóstico de dados: radar dos 5 eixos, evidência × resposta.
5. Oportunidades: matriz valor × esforço e cards.
6. Roadmap 12 meses em 3 ondas (0–3, 3–6, 6–12 meses) com dependências.
7. Proposta de squad: perfis, duração e KPIs a medir contra o baseline.
8. Apêndice de premissas: cada número com sua origem.

## 7. Cálculos (determinísticos, TypeScript)

Em `common/diagnostic-math.ts`, sem dependência de IA:
- `custoMensalProcesso = Σ medianDurationMs(etapas) [h] × volumePerMonth × hourlyCost(role)`
- `custoEtapa` análogo por etapa; `economia = Σ custoEtapa(stepIds) × min(estimatedSavingsPct, tetoOnda)`
- Tetos padrão: onda 1 = 30%, onda 2 = 60%, onda 3 = 80%.
- **Score de Processos (0–100):** parte de 100 e penaliza variação entre
  execuções, proporção de transferências manuais, retrabalho e etapas sem dono.
- **Score de Dados (0–100):** 60% questionário confirmado (normalizado) +
  40% evidência observada (proporção de etapas com dado estruturado).
- **Score de Prontidão para IA:** `min(processos, dados)` ponderado
  (padrão: `0.7 × min + 0.3 × média`) — a IA nunca está mais pronta que a base.
- Pesos, penalidades e tetos ficam em `common/diagnostic-config.ts`,
  versionados, com a versão gravada no relatório.

## 8. Erros

- Falha/timeout/saída inválida da IA: preserva o estado anterior e oferece
  "Tentar novamente" (padrão `src/analysis-recovery.ts`); saída fora do schema
  é devolvida ao agente com o erro Zod para nova tentativa no mesmo turno.
- Processo com 1 gravação: permitido; mapa marcado "baixa confiança, sem
  variação medida".
- Sessão vinculada apagada: aviso no processo; mapa marcado desatualizado.
- Arquivo corrompido: leitura falha com mensagem clara; escrita sempre atômica.

## 9. Testes

- **Unitários (Vitest):** `diagnostic-math` (custos, tetos, scores, arredondamento),
  schemas, regras de bloqueio (rascunho; onda 3 com pré-requisito pendente),
  persistência de engagement.
- **Evals (`evals/`):** 2–3 cenários sintéticos (ex.: conciliação com
  planilha + e-mail + ERP) verificando consolidação de etapas e respeito à
  ordem dados → automação → IA.
- **Relatório:** snapshot do HTML a partir de engagement fixo; render PDF
  via Playwright/Chromium.

## 10. Fora de escopo

Painel vivo; telemetria/OpenTelemetry das automações; controle de custo de
tokens do app; workflow/CRM da esteira de FDE; integrações com ERP/folha;
multi-tenant, nuvem e login.
