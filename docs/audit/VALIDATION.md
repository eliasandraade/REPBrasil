# Validação da worktree de auditoria

Data: 12/10/2026. Snapshot c56dabf5bd4178ed92573300555f48996b14c8cb. Node 22.19.0, npm 10.9.3, Windows/PowerShell. Código sem alteração durante a preparação.

| Verificação | Resultado | Evidência |
| --- | --- | --- |
| npm ci --no-audit --no-fund | PASS, 485 pacotes, lockfile preservado | Instalação limpa na worktree; warnings listados abaixo |
| npm run lint | PASS, exit 0 | evidence/lint.txt |
| npm run typecheck | PASS, exit 0 | evidence/typecheck.txt |
| npm test | PASS, exit 0, 106 testes / 8 arquivos | evidence/tests.txt |
| npm run build | PASS, exit 0, Next 15.5.18 | evidence/build.txt |
| Runtime frontend 3400 + API 5400 | PASS local | evidence/http-status.txt e preview-3400.jpg |
| Código e lockfile contra snapshot | sem diferenças | git diff c56dabf -- frontend backend etl infra |

Hash Git do lockfile no snapshot e na worktree: b581aef9fe6c1ee7dadfbc3e561dec9c89af2506. Build gerou worker e .next ignorados pelo Git. Nenhum artefato de build ou node_modules entrou na documentação.

Warnings preservados: npm informa depreciação de @types/prettier, inflight, @humanwhocodes/config-array, @humanwhocodes/object-schema, whatwg-encoding, rimraf, glob e eslint. next lint avisa depreciação futura do comando. Não foi realizado npm audit; ausência de atualização não significa ausência de vulnerabilidade. Vitest emite `Error: Not implemented: navigation (except hash changes)` do jsdom, com todos os testes aprovados. Não houve correção desses avisos.

Rotas `/`, `/eleicoes`, `/eleicoes/2026/1/ce`, `/politicos/ciro-gomes` e `/eleicoes/comparar` responderam 200. Ano 1900 e `/login` responderam 404. Status HTTP não substitui inspeção de cada fluxo. Na inspeção de navegador em 3400, home, geometria, catálogo e cobertura carregaram com a API 5400; console sem erros/avisos nessa passagem. A captura desta worktree está em [preview-3400.jpg](evidence/preview-3400.jpg).

First Load JS reportado: home 129 kB, catálogo 120 kB, comparação 127 kB, perfil 145 kB, compartilhado 103 kB. O segmento catch-all isolado não expressa o custo de MapLibre dinâmico. Sem benchmark de campo, dispositivo físico, FPS, auditoria completa de acessibilidade ou certificação de integridade da base eleitoral.

API de auditoria executada com migrações desabilitadas e conexão com `default_transaction_read_only=on`; CORS confirmou a origem 3400. Nenhuma operação de escrita na base foi executada. Frontend principal 3000 e API principal 5000 não foram reiniciados ou reconfigurados.

## Alterações da preparação

1. Commit de preservação do working tree existente, sem mudanças visuais/funcionais novas.
2. Branch audit/astra-redesign-v1 e worktree irmã no snapshot; validação nela.
3. Somente docs/audit acrescentado depois do snapshot: relatório, inventário, logs de verificações, captura, listas Git e regra para excluir logs locais de servidores.
4. Instalação pelo lockfile e processos locais de auditoria; nenhum .env copiado.

## Limites e pendências para o auditor

- O baseline Git não inclui as alterações locais preexistentes listadas no relatório. Não é possível atribuir todo o delta ao Astra com precisão de hunk.
- Dados locais não são empacotados. Uma máquina externa precisa de API compatível/configuração autorizada; os estados de erro continuam auditáveis sem ela.
- Documentos anteriores em docs/audits referenciam logs locais de uma sessão anterior. Esses logs não foram incluídos no snapshot; use os logs novos em docs/audit/evidence para a reprodução desta entrega.
- A auditoria componente a componente, aparelhos físicos, leitores de tela e métricas de produção continuam fora desta preparação.
- Não houve PR, merge, deploy, force-push ou alteração de main.
