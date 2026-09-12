# Referência de Comandos do GSD

Este documento descreve os comandos principais do GSD em Português.  
Para detalhes completos de flags avançadas e mudanças recentes, consulte também a [versão em inglês](../COMMANDS.md).

---

## Fluxo Principal

| Comando | Finalidade | Quando usar |
|---------|------------|-------------|
| `/fvgsd-new-project` | Inicialização completa: perguntas, pesquisa, requisitos e roadmap | Início de projeto |
| `/fvgsd-discuss-phase [N]` | Captura decisões de implementação (`--chain`, `--power`) | Antes do planejamento |
| `/fvgsd-ui-phase [N]` | Gera contrato de UI (`UI-SPEC.md`) | Fases com frontend |
| `/fvgsd-plan-phase [N]` | Pesquisa + planejamento + verificação | Antes de executar uma fase |
| `/fvgsd-execute-phase <N>` | Executa planos em ondas paralelas | Após planejamento aprovado |
| `/fvgsd-verify-work [N]` | UAT manual com diagnóstico automático | Após execução |
| `/fvgsd-ship [N]` | Cria PR da fase validada | Ao concluir a fase |
| `/fvgsd-progress --next` | Detecta e executa o próximo passo lógico | Qualquer momento |
| `/fvgsd-fast <texto>` | Tarefa curta sem planejamento completo | Ajustes triviais |

## Navegação e Sessão

| Comando | Finalidade |
|---------|------------|
| `/fvgsd-progress` | Mostra status atual e próximos passos |
| `/fvgsd-resume-work` | Retoma contexto da sessão anterior |
| `/fvgsd-pause-work` | Salva handoff estruturado |
| `/fvgsd-pause-work --report` | Gera resumo da sessão |
| `/fvgsd-autonomous` | Executa todas as fases restantes de forma autônoma (`--from N`, `--to N`, `--only N`) |
| `/fvgsd-help` | Lista comandos e uso |
| `/fvgsd-update` | Atualiza o GSD |

## Gestão de Fases

| Comando | Finalidade |
|---------|------------|
| `/fvgsd-phase` | Adiciona fase no roadmap |
| `/fvgsd-phase --insert [N]` | Insere trabalho urgente entre fases |
| `/fvgsd-phase --remove [N]` | Remove fase futura e reenumera |
| `/fvgsd-discuss-phase --assumptions [N]` | Mostra abordagem assumida pelo Claude |

## Brownfield e Utilidades

| Comando | Finalidade |
|---------|------------|
| `/fvgsd-map-codebase` | Mapeia base existente antes de novo projeto |
| `/fvgsd-quick` | Tarefas ad-hoc com garantias do GSD |
| `/fvgsd-debug [desc]` | Debug sistemático com estado persistente (`--diagnose` para modo diagnóstico) |
| `/fvgsd-manager --analyze-deps` | Detecta dependências entre fases e sugere `Depends on` no ROADMAP.md (v1.32) |
| `/fvgsd-forensics` | Diagnóstico de falhas no workflow |
| `/fvgsd-settings` | Configuração de agentes, perfil e toggles |
| `/fvgsd-config --profile <perfil>` | Troca rápida de perfil de modelo |

## Qualidade de Código

| Comando | Finalidade |
|---------|------------|
| `/fvgsd-review` | Peer review com múltiplas IAs |
| `/fvgsd-pr-branch` | Cria branch limpa sem commits de planejamento |
| `/fvgsd-audit-uat` | Audita dívida de validação/UAT |

## Backlog e Threads

| Comando | Finalidade |
|---------|------------|
| `/fvgsd-capture --backlog <desc>` | Adiciona item no backlog (999.x) |
| `/fvgsd-review-backlog` | Promove, mantém ou remove itens |
| `/fvgsd-capture --seed <ideia>` | Registra ideia com gatilho futuro |
| `/fvgsd-thread [nome]` | Gerencia threads persistentes |

## Gerenciamento de Estado

| Comando | Finalidade |
|---------|------------|
| `state validate` | Detecta drift entre STATE.md e o filesystem real |
| `state sync` | Reconstrói STATE.md a partir do estado real no disco |
| `state sync --verify` | Dry-run: mostra mudanças propostas sem gravar |
| `state planned-phase --phase N --plans N` | Registra transição de estado após plan-phase |

```bash
node fvgsd-tools.cjs state validate          # Detectar drift
node fvgsd-tools.cjs state sync --verify     # Prévia do que sync mudaria
node fvgsd-tools.cjs state sync              # Reconstruir STATE.md a partir do disco
```

---

## Exemplo rápido

```bash
/fvgsd-new-project
/fvgsd-discuss-phase 1
/fvgsd-plan-phase 1
/fvgsd-execute-phase 1
/fvgsd-verify-work 1
/fvgsd-ship 1
```
