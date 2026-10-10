"""Candidaturas oficiais do TSE e resolução determinística de identidade.

Fontes (Portal de Dados Abertos do TSE, dataset "Candidatos - <ano>"):
- recurso "Candidatos" (consulta_cand_<ano>.zip): uma linha por candidatura
  (SQ_CANDIDATO) com cargo, número, partido e situação DAQUELA eleição;
- recurso "Histórico de candidaturas" (historico_candidatura_<ano>.zip): para
  cada candidatura atual (SQ_CANDIDATO_ATUAL), as candidaturas anteriores da
  mesma pessoa segundo o próprio TSE.

Regras (docs/TSE_IDENTITY.md):
- identidade humana = CPF publicado pelo TSE, guardado SOMENTE como HMAC-SHA256
  com chave secreta em public."Persons"."NormalizedDocumentHash";
- vínculo com perfis já existentes SOMENTE por identificadores oficiais
  (Politician.TseId = SQ_CANDIDATO de uma candidatura listada no histórico);
- nome nunca decide identidade; sem documento válido a candidatura fica
  `unresolved_*` e continua visível nos resultados;
- vínculo votável do BU → candidatura por (CD_ELEICAO, cargo, número) na
  unidade eleitoral; ambíguo ou divergente ⇒ sem vínculo, registrado.
"""
