# Guia do Usuário do GSD

Referência detalhada de workflows, troubleshooting e configuração. Para setup rápido, veja o [README](../../README.pt-BR.md).

---

## Sumário

- [Fluxo de trabalho](#fluxo-de-trabalho)
- [Contrato de UI](#contrato-de-ui)
- [Backlog e Threads](#backlog-e-threads)
- [Workstreams](#workstreams)
- [Segurança](#segurança)
- [Referência de comandos](#referência-de-comandos)
- [Configuração](#configuração)
- [Exemplos de uso](#exemplos-de-uso)
- [Troubleshooting](#troubleshooting)
- [Recuperação rápida](#recuperação-rápida)

---

## Fluxo de trabalho

Fluxo recomendado por fase:

1. `/fvgsd-discuss-phase [N]` — trava preferências de implementação
2. `/fvgsd-ui-phase [N]` — contrato visual para fases frontend
3. `/fvgsd-plan-phase [N]` — pesquisa + plano + validação
4. `/fvgsd-execute-phase [N]` — execução em ondas paralelas
5. `/fvgsd-verify-work [N]` — UAT manual com diagnóstico
6. `/fvgsd-ship [N]` — cria PR (opcional)

Para iniciar projeto novo:

```bash
/fvgsd-new-project
```

Para seguir automaticamente o próximo passo:

```bash
/fvgsd-progress --next
```

### Nyquist Validation

Durante `plan-phase`, o GSD pode mapear requisitos para comandos de teste automáticos antes da implementação. Isso gera `{phase}-VALIDATION.md` e aumenta a confiabilidade de verificação pós-execução.

Desativar:

```json
{
  "workflow": {
    "nyquist_validation": false
  }
}
```

### Modo de discussão por suposições

Com `workflow.discuss_mode: "assumptions"`, o GSD analisa o código antes de perguntar, apresenta suposições estruturadas e pede apenas correções.

---

## Contrato de UI

### Comandos

| Comando | Descrição |
|---------|-----------|
| `/fvgsd-ui-phase [N]` | Gera contrato de design `UI-SPEC.md` para a fase |
| `/fvgsd-ui-review [N]` | Auditoria visual retroativa em 6 pilares |

### Quando usar

- Rode `/fvgsd-ui-phase` depois de `/fvgsd-discuss-phase` e antes de `/fvgsd-plan-phase`.
- Rode `/fvgsd-ui-review` após execução/validação para avaliar qualidade visual e consistência.

### Configurações relacionadas

| Setting | Padrão | O que controla |
|---------|--------|----------------|
| `workflow.ui_phase` | `true` | Gera contratos de UI para fases frontend |
| `workflow.ui_safety_gate` | `true` | Ativa gate de segurança para componentes de registry |

---

## Backlog e Threads

### Backlog (999.x)

Ideias fora da sequência ativa vão para backlog:

```bash
/fvgsd-capture --backlog "Camada GraphQL"
/fvgsd-capture --backlog "Responsividade mobile"
```

Promover/revisar:

```bash
/fvgsd-review-backlog
```

### Seeds

Seeds guardam ideias futuras com condição de gatilho:

```bash
/fvgsd-capture --seed "Adicionar colaboração real-time quando infra de WebSocket estiver pronta"
```

### Threads persistentes

Threads são contexto leve entre sessões:

```bash
/fvgsd-thread
/fvgsd-thread fix-deploy-key-auth
/fvgsd-thread "Investigar timeout TCP"
```

---

## Workstreams

Workstreams permitem trabalho paralelo sem colisão de estado de planejamento.

| Comando | Função |
|---------|--------|
| `/fvgsd-workstreams create <name>` | Cria workstream isolado |
| `/fvgsd-workstreams switch <name>` | Troca workstream ativo |
| `/fvgsd-workstreams list` | Lista workstreams |
| `/fvgsd-workstreams complete <name>` | Finaliza e arquiva workstream |

`workstreams` compartilham o mesmo código/git, mas isolam artefatos de `.planning/`.

---

## Segurança

O GSD aplica defesa em profundidade:

- prevenção de path traversal em entradas de arquivo
- detecção de prompt injection em texto do usuário
- hooks de proteção para escrita em `.planning/`
- scanner CI para padrões de injeção em agentes/workflows/comandos

Para arquivos sensíveis, use deny list no Claude Code.

---

## Referência de comandos

### Fluxo principal

| Comando | Quando usar |
|---------|-------------|
| `/fvgsd-new-project` | Início de projeto |
| `/fvgsd-discuss-phase [N]` | Definir preferências antes do plano |
| `/fvgsd-plan-phase [N]` | Criar e validar planos |
| `/fvgsd-execute-phase [N]` | Executar planos em ondas |
| `/fvgsd-verify-work [N]` | UAT manual |
| `/fvgsd-ship [N]` | Gerar PR da fase |
| `/fvgsd-progress --next` | Próximo passo automático |

### Gestão e utilidades

| Comando | Quando usar |
|---------|-------------|
| `/fvgsd-progress` | Ver status atual |
| `/fvgsd-resume-work` | Retomar sessão |
| `/fvgsd-pause-work` | Pausar com handoff |
| `/fvgsd-pause-work --report` | Resumo da sessão |
| `/fvgsd-quick` | Tarefa ad-hoc com garantias GSD |
| `/fvgsd-debug [desc]` | Debug sistemático |
| `/fvgsd-forensics` | Diagnóstico de workflow quebrado |
| `/fvgsd-settings` | Ajustar workflow/modelos |
| `/fvgsd-config --profile <profile>` | Troca rápida de perfil |

Para lista completa e flags avançadas, consulte [Command Reference](../COMMANDS.md).

---

## Configuração

Arquivo de configuração: `.planning/config.json`

### Núcleo

| Setting | Opções | Padrão |
|---------|--------|--------|
| `mode` | `interactive`, `yolo` | `interactive` |
| `granularity` | `coarse`, `standard`, `fine` | `standard` |
| `model_profile` | `quality`, `balanced`, `budget`, `inherit` | `balanced` |

### Workflow

| Setting | Padrão |
|---------|--------|
| `workflow.research` | `true` |
| `workflow.plan_check` | `true` |
| `workflow.verifier` | `true` |
| `workflow.nyquist_validation` | `true` |
| `workflow.ui_phase` | `true` |
| `workflow.ui_safety_gate` | `true` |

### Perfis de modelo

| Perfil | Uso recomendado |
|--------|------------------|
| `quality` | trabalho crítico, maior qualidade |
| `balanced` | padrão recomendado |
| `budget` | reduzir custo de tokens |
| `inherit` | seguir modelo da sessão/runtime |

Detalhes completos: [Configuration Reference](../CONFIGURATION.md).

---

## Exemplos de uso

### Projeto novo

```bash
claude --dangerously-skip-permissions
/fvgsd-new-project
/fvgsd-discuss-phase 1
/fvgsd-ui-phase 1
/fvgsd-plan-phase 1
/fvgsd-execute-phase 1
/fvgsd-verify-work 1
/fvgsd-ship 1
```

### Código já existente

```bash
/fvgsd-map-codebase
/fvgsd-new-project
```

### Correção rápida

```bash
/fvgsd-quick
> "Corrigir botão de login no mobile Safari"
```

### Preparação para release

```bash
/fvgsd-audit-milestone
/fvgsd-complete-milestone
```

---

## Troubleshooting

### "Project already initialized"

`.planning/PROJECT.md` já existe. Apague `.planning/` se quiser reiniciar do zero.

### Sessão longa degradando contexto

Use `/clear` entre etapas grandes e retome com `/fvgsd-resume-work` ou `/fvgsd-progress`.

### Plano desalinhado

Rode `/fvgsd-discuss-phase [N]` antes do plano e valide suposições com `/fvgsd-discuss-phase --assumptions [N]`.

### Execução falhou ou saiu com stubs

Replaneje com escopo menor (tarefas menores por plano).

### Custo alto

Use perfil budget:

```bash
/fvgsd-config --profile budget
```

### Runtime não-Claude (Codex/OpenCode/Gemini/Kilo)

Use `resolve_model_ids: "omit"` para deixar o runtime resolver modelos padrão.

---

## Recuperação rápida

| Problema | Solução |
|---------|---------|
| Perdeu contexto | `/fvgsd-resume-work` ou `/fvgsd-progress` |
| Fase deu errado | `git revert` + replanejar |
| Precisa alterar escopo | `/fvgsd-phase`, `/fvgsd-phase --insert`, `/fvgsd-phase --remove` |
| Bug em workflow | `/fvgsd-forensics` |
| Correção pontual | `/fvgsd-quick` |
| Custo alto | `/fvgsd-config --profile budget` |
| Não sabe próximo passo | `/fvgsd-progress --next` |

---

## Estrutura de arquivos do projeto

```text
.planning/
  PROJECT.md
  REQUIREMENTS.md
  ROADMAP.md
  STATE.md
  config.json
  MILESTONES.md
  HANDOFF.json
  research/
  reports/
  todos/
  debug/
  codebase/
  phases/
    XX-phase-name/
      XX-YY-PLAN.md
      XX-YY-SUMMARY.md
      CONTEXT.md
      RESEARCH.md
      VERIFICATION.md
      XX-UI-SPEC.md
      XX-UI-REVIEW.md
  ui-reviews/
```

> [!NOTE]
> Esta é a versão pt-BR do guia para uso diário. Para detalhes técnicos exatos e cobertura completa de parâmetros avançados, consulte também o [guia original em inglês](../USER-GUIDE.md).
