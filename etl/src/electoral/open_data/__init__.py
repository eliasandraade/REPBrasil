"""Pipeline histórico: Portal de Dados Abertos do TSE → Boletim de Urna (CSV).

Caminho complementar ao pipeline live (EA11 → EA12 → EA16 → EA18 → BU → EA20),
que continua existindo para o dia da eleição e para auditoria.

Etapas separadas para permitir auditoria:
  discovery   (ckan.py)     metadados oficiais CKAN → recurso por UF/turno
  acquisition (acquire.py)  ZIP + checksum oficial → artefato content-addressed
  parse       (layout.py, parser.py)  CSV Latin-1 em streaming, layout verificado
  normalize   (results.py)  urna/cargo/votável, métricas estruturais sem soma
  reconcile   (reconcile.py) cadastro do piloto: seções, agregações, aptos
  persist     (store.py)    PostgreSQL, idempotente e versionado por arquivo
"""
