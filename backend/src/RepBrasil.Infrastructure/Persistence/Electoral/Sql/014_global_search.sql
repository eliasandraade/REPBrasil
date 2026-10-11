-- REP Brasil — busca global: normalização sem acento e índice de trigramas para nomes de políticos.
--
-- public.search_fold(texto): tira o acento (tabela fixa do português, maiúsculas e minúsculas),
-- passa para minúsculas, troca tudo que não é [a-z0-9] por espaço e apara as pontas. É a MESMA
-- regra de SearchService.Fold (C#) — mudar uma exige mudar a outra. Fica em public porque indexa
-- public."Politicians" (e assim sobrevive à recriação do schema electoral nos testes do ETL).
--
-- O texto pesquisável começa com espaço: "o termo começa uma palavra" vira LIKE '% termo%', filtro
-- que o índice GIN de trigramas (pg_trgm) atende sem varrer a tabela. Só leitura: nenhum dado muda.

CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;

CREATE OR REPLACE FUNCTION public.search_fold(value text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT btrim(regexp_replace(lower(translate(coalesce(value, ''),
    'ÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÝÇÑáàâãäåéèêëíìîïóòôõöúùûüýÿçñ',
    'AAAAAAEEEEIIIIOOOOOUUUUYCNaaaaaaeeeeiiiiooooouuuuyycn')), '[^a-z0-9]+', ' ', 'g'))
$$;

CREATE INDEX IF NOT EXISTS politicians_search_trgm_idx ON public."Politicians"
  USING gin ((' ' || public.search_fold("BallotName") || ' ' || public.search_fold("Name")) public.gin_trgm_ops)
  WHERE "DeletedAt" IS NULL;
