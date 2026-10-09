"""Cadastro eleitoral genérico a partir de fontes oficiais do TSE.

Três fontes, três autoridades — nunca misturadas:

- território (UF/município, códigos TSE ↔ IBGE): "Códigos oficiais de UF e
  municípios segundo o TSE e o IBGE" (`territories.py`);
- cadastro eleitoral (zona → local → seção, agregações, aptos por urna):
  "Eleitorado por local de votação - <ano>" (`polling_places.py`);
- votos: Boletim de Urna (`urnai_ingest.open_data`), reconciliado contra o
  cadastro canônico.

Nenhum módulo daqui conhece um município pelo nome: tudo é identificado por
código oficial (UF, código TSE do município, número da zona, número da seção).
"""
