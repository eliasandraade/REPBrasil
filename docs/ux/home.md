# UX — Home REPBrasil

## Inspiração

A experiência da home é inspirada no CSRep: busca central, sem distração,
com acesso imediato a estatísticas e links institucionais.

## Elementos obrigatórios

### Topo
- Logo REPBrasil
- Slogan: "Apenas dados. Sem discursos."

### Busca central (elemento principal)
- Campo de busca grande, centralizado
- Placeholder: "Buscar político, partido, estado ou cargo..."
- Aceita: nome, nome de urna, partido, estado, cargo, cidade
- Auto-complete futuro (Fase 3)

### Estatísticas gerais (abaixo da busca)
- Total de políticos cadastrados
- Total de eleições cobertas
- Total de fontes ativas
- Data da última atualização

### Explicação curta
- 2–3 frases explicando o que é o REPBrasil
- Link para o manifesto completo
- Link para a metodologia

### Rodapé institucional
- Link: Manifesto
- Link: Metodologia
- Link: API / Documentação
- Link: GitHub
- Link: Contribuir
- Licença AGPL-3.0

## Regras de design

- Mobile first (funcionar em 3G, celular simples)
- Primeiro carregamento deve ser leve (< 100KB HTML+CSS)
- Sem JavaScript obrigatório para ver a busca
- Grafo e análises avançadas: apenas sob demanda
- Sem animações pesadas

## O que NÃO deve aparecer na home

- Rankings políticos (induz interpretação)
- Notícias ou feeds externos
- Publicidade
- Chamadas para doação no primeiro fold
- Gráficos pesados no carregamento inicial
