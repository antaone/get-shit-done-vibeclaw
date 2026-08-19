# Referência de Comandos do GSD

Este documento descreve os comandos principais do GSD em Português.  
Para detalhes completos de flags avançadas e mudanças recentes, consulte também a [versão em inglês](../COMMANDS.md).

---

## Fluxo Principal

| Comando | Finalidade | Quando usar |
|---------|------------|-------------|
| `/vgsd-new-project` | Inicialização completa: perguntas, pesquisa, requisitos e roadmap | Início de projeto |
| `/vgsd-discuss-phase [N]` | Captura decisões de implementação (`--chain`, `--power`) | Antes do planejamento |
| `/vgsd-ui-phase [N]` | Gera contrato de UI (`UI-SPEC.md`) | Fases com frontend |
| `/vgsd-plan-phase [N]` | Pesquisa + planejamento + verificação | Antes de executar uma fase |
| `/vgsd-execute-phase <N>` | Executa planos em ondas paralelas | Após planejamento aprovado |
| `/vgsd-verify-work [N]` | UAT manual com diagnóstico automático | Após execução |
| `/vgsd-ship [N]` | Cria PR da fase validada | Ao concluir a fase |
| `/vgsd-progress --next` | Detecta e executa o próximo passo lógico | Qualquer momento |
| `/vgsd-fast <texto>` | Tarefa curta sem planejamento completo | Ajustes triviais |

## Navegação e Sessão

| Comando | Finalidade |
|---------|------------|
| `/vgsd-progress` | Mostra status atual e próximos passos |
| `/vgsd-resume-work` | Retoma contexto da sessão anterior |
| `/vgsd-pause-work` | Salva handoff estruturado |
| `/vgsd-pause-work --report` | Gera resumo da sessão |
| `/vgsd-autonomous` | Executa todas as fases restantes de forma autônoma (`--from N`, `--to N`, `--only N`) |
| `/vgsd-help` | Lista comandos e uso |
| `/vgsd-update` | Atualiza o GSD |

## Gestão de Fases

| Comando | Finalidade |
|---------|------------|
| `/vgsd-phase` | Adiciona fase no roadmap |
| `/vgsd-phase --insert [N]` | Insere trabalho urgente entre fases |
| `/vgsd-phase --remove [N]` | Remove fase futura e reenumera |
| `/vgsd-discuss-phase --assumptions [N]` | Mostra abordagem assumida pelo Claude |

## Brownfield e Utilidades

| Comando | Finalidade |
|---------|------------|
| `/vgsd-map-codebase` | Mapeia base existente antes de novo projeto |
| `/vgsd-quick` | Tarefas ad-hoc com garantias do GSD |
| `/vgsd-debug [desc]` | Debug sistemático com estado persistente (`--diagnose` para modo diagnóstico) |
| `/vgsd-manager --analyze-deps` | Detecta dependências entre fases e sugere `Depends on` no ROADMAP.md (v1.32) |
| `/vgsd-forensics` | Diagnóstico de falhas no workflow |
| `/vgsd-settings` | Configuração de agentes, perfil e toggles |
| `/vgsd-config --profile <perfil>` | Troca rápida de perfil de modelo |

## Qualidade de Código

| Comando | Finalidade |
|---------|------------|
| `/vgsd-review` | Peer review com múltiplas IAs |
| `/vgsd-pr-branch` | Cria branch limpa sem commits de planejamento |
| `/vgsd-audit-uat` | Audita dívida de validação/UAT |

## Backlog e Threads

| Comando | Finalidade |
|---------|------------|
| `/vgsd-capture --backlog <desc>` | Adiciona item no backlog (999.x) |
| `/vgsd-review-backlog` | Promove, mantém ou remove itens |
| `/vgsd-capture --seed <ideia>` | Registra ideia com gatilho futuro |
| `/vgsd-thread [nome]` | Gerencia threads persistentes |

## Gerenciamento de Estado

| Comando | Finalidade |
|---------|------------|
| `state validate` | Detecta drift entre STATE.md e o filesystem real |
| `state sync` | Reconstrói STATE.md a partir do estado real no disco |
| `state sync --verify` | Dry-run: mostra mudanças propostas sem gravar |
| `state planned-phase --phase N --plans N` | Registra transição de estado após plan-phase |

```bash
node gsd-tools.cjs state validate          # Detectar drift
node gsd-tools.cjs state sync --verify     # Prévia do que sync mudaria
node gsd-tools.cjs state sync              # Reconstruir STATE.md a partir do disco
```

---

## Exemplo rápido

```bash
/vgsd-new-project
/vgsd-discuss-phase 1
/vgsd-plan-phase 1
/vgsd-execute-phase 1
/vgsd-verify-work 1
/vgsd-ship 1
```
