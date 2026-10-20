"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { DataState, RetryButton } from "@/components/ui/DataState";
import { formatDateTime } from "@/components/account/format";
import { Field, FIELD_CONTROL } from "@/components/account/Field";
import { adminApi, type JsonSchema, type OpenApiDocument, type OpenApiOperation, type RouteAccess, type RouteMetric } from "@/lib/admin";
import { API_URL } from "@/lib/api";
import { PLAN_NAME } from "@/lib/plans";

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** Área do OpenAPI (nome do controller) em português, só para leitura. */
const TAG_LABEL: Record<string, string> = {
  Account: "Conta e autenticação",
  CommercialApi: "API comercial (legado)",
  Data: "Dados socioeconômicos",
  Elections: "Eleições",
  ElectoralLive: "Pesquisas e apuração",
  Health: "Saúde do serviço",
  Overview: "Visão geral",
  Parliament: "Parlamento",
  Parties: "Partidos",
  Plans: "Planos e cobrança",
  Politicians: "Políticos",
  Rankings: "Rankings",
  Search: "Busca",
  Territories: "Territórios",
};

interface Operation {
  method: string;
  path: string;
  tag: string;
  op: OpenApiOperation;
  access: RouteAccess | null;
  metric: RouteMetric | undefined;
}

/** "api/v1/elections/{year:int}" (rota-modelo das métricas) → "/api/v1/elections/{year}" (caminho do OpenAPI). */
export function normalizeRoute(raw: string): string {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "{") {
      const end = raw.indexOf("}", i);
      if (end < 0) break;
      const name = raw.slice(i + 1, end).split(":")[0].replace(/[?*]/g, "");
      out += `{${name}}`;
      i = end + 1;
    } else {
      out += raw[i];
      i += 1;
    }
  }
  return out.startsWith("/") ? out : `/${out}`;
}

export function accessLabel(access: RouteAccess | null): string {
  if (!access) return "Não informado";
  switch (access.kind) {
    case "public": return "Público";
    case "session": return access.csrf ? "Sessão + CSRF" : "Sessão";
    case "capability": {
      const plan = access.requiredPlan ? PLAN_NAME[access.requiredPlan] : "específico";
      return `Plano ${plan}${access.csrf ? " + CSRF" : ""}`;
    }
    case "superadmin": return access.csrf ? "Super Admin + CSRF" : "Super Admin";
    case "header": return `Cabeçalho ${access.header ?? ""}`.trim();
  }
}

function resolve(schema: JsonSchema | undefined, doc: OpenApiDocument): { name: string | null; schema: JsonSchema | undefined } {
  if (!schema?.$ref) return { name: null, schema };
  const name = schema.$ref.split("/").at(-1) ?? schema.$ref;
  return { name, schema: doc.components?.schemas?.[name] };
}

function typeOf(schema: JsonSchema | undefined, doc: OpenApiDocument): string {
  if (!schema) return "—";
  if (schema.$ref) return resolve(schema, doc).name ?? "objeto";
  const type = Array.isArray(schema.type) ? schema.type.filter((t) => t !== "null").join(" | ") : schema.type;
  if (type === "array") return `${typeOf(schema.items, doc)}[]`;
  if (schema.enum) return schema.enum.map(String).join(" | ");
  return [type ?? "objeto", schema.format].filter(Boolean).join(" · ");
}

/** Propriedades do schema (um nível; referências abrem sob demanda). */
function SchemaView({ schema, doc, depth = 0 }: Readonly<{ schema: JsonSchema | undefined; doc: OpenApiDocument; depth?: number }>) {
  const { name, schema: resolved } = resolve(schema?.type === "array" ? schema.items : schema, doc);
  const properties = resolved?.properties;
  if (!properties || depth > 2) return <code className="text-micro text-fg-soft">{typeOf(schema, doc)}</code>;
  return (
    <div>
      {name && <p className="text-micro text-fg-muted">{name}{schema?.type === "array" ? "[]" : ""}</p>}
      <ul className="mt-1 space-y-1 border-l border-line pl-3">
        {Object.entries(properties).map(([prop, value]) => {
          const nested = value.$ref || (value.type === "array" && value.items?.$ref);
          return (
            <li key={prop} className="text-micro">
              <code className="text-fg">{prop}</code>
              {resolved?.required?.includes(prop) ? <span className="text-fg-muted"> (obrigatório)</span> : null}{" "}
              {nested && depth < 2 ? (
                <details className="inline-block align-top">
                  <summary className="focus-ring cursor-pointer rounded text-accent-text">{typeOf(value, doc)}</summary>
                  <SchemaView schema={value} doc={doc} depth={depth + 1} />
                </details>
              ) : (
                <span className="text-fg-muted">{typeOf(value, doc)}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Executa uma rota GET pública sem parâmetro obrigatório e mostra status, tempo e o começo da resposta. */
function TryIt({ path }: Readonly<{ path: string }>) {
  const [result, setResult] = useState<{ status: number; ms: number; size: number; preview: string } | { error: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    const started = performance.now();
    try {
      const response = await fetch(`${API_URL}${path}`, { headers: { Accept: "application/json" } });
      const text = await response.text();
      setResult({ status: response.status, ms: Math.round(performance.now() - started), size: text.length, preview: text.slice(0, 1200) });
    } catch {
      setResult({ error: "Sem resposta da API." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3">
      <button type="button" onClick={() => void run()} disabled={busy} className="focus-ring rounded-md border border-line px-3 py-1.5 text-micro font-medium text-fg hover:bg-fg/[0.04] disabled:opacity-60">
        {busy ? "Executando…" : "Executar GET público"}
      </button>
      {result && (
        <div className="mt-2" role="status">
          {"error" in result ? (
            <p className="text-micro text-danger">{result.error}</p>
          ) : (
            <>
              <p className="text-micro text-fg-muted">HTTP {result.status} · {result.ms} ms · {result.size.toLocaleString("pt-BR")} caracteres</p>
              <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-subtle p-2 text-micro text-fg-soft">{result.preview}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function OperationRow({ operation, doc }: Readonly<{ operation: Operation; doc: OpenApiDocument }>) {
  const { method, path, op, access, metric } = operation;
  const required = (op.parameters ?? []).some((p) => p.required);
  const canTry = method === "get" && access?.kind === "public" && !required && !path.includes("{");
  const body = op.requestBody?.content?.["application/json"]?.schema;
  return (
    <details className="group border-b border-line">
      <summary className="focus-ring flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 rounded py-2.5">
        <code className="w-14 shrink-0 text-micro font-semibold uppercase text-fg">{method}</code>
        <code className="min-w-0 flex-1 break-all text-body-sm text-fg">{path}</code>
        <span className="text-micro text-fg-soft">{accessLabel(access)}</span>
        <span className="text-micro tabular-nums text-fg-muted">
          {metric ? `${metric.calls.toLocaleString("pt-BR")} chamadas · ${metric.serverErrors} 5xx · p95 ${metric.p95Ms ?? "—"} ms` : "sem chamadas"}
        </span>
      </summary>
      <div className="space-y-4 pb-4 pl-[4.25rem] text-body-sm">
        {(op.summary || op.description) && <p className="text-fg-soft">{op.summary ?? op.description}</p>}
        {access?.capability && <p className="text-micro text-fg-muted">Recurso exigido: <code>{access.capability}</code></p>}
        {op.parameters && op.parameters.length > 0 && (
          <table className="w-full max-w-3xl text-micro">
            <caption className="sr-only">Parâmetros</caption>
            <thead><tr className="text-left text-fg-muted"><th className="py-1 pr-3">Parâmetro</th><th className="py-1 pr-3">Onde</th><th className="py-1 pr-3">Tipo</th><th className="py-1">Obrigatório</th></tr></thead>
            <tbody>
              {op.parameters.map((p) => (
                <tr key={`${p.in}:${p.name}`} className="border-t border-line">
                  <td className="py-1 pr-3"><code className="text-fg">{p.name}</code></td>
                  <td className="py-1 pr-3 text-fg-muted">{p.in}</td>
                  <td className="py-1 pr-3 text-fg-muted">{typeOf(p.schema, doc)}</td>
                  <td className="py-1 text-fg-muted">{p.required ? "sim" : "não"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {body && (
          <div>
            <p className="text-label uppercase text-fg-muted">Corpo (JSON)</p>
            <div className="mt-1"><SchemaView schema={body} doc={doc} /></div>
          </div>
        )}
        {op.responses && (
          <div>
            <p className="text-label uppercase text-fg-muted">Respostas</p>
            <ul className="mt-1 space-y-1">
              {Object.entries(op.responses).map(([code, response]) => (
                <li key={code} className="text-micro">
                  <code className="text-fg">{code}</code> <span className="text-fg-muted">{response.description}</span>
                  {response.content?.["application/json"]?.schema && <div className="mt-1"><SchemaView schema={response.content["application/json"].schema} doc={doc} /></div>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {canTry && <TryIt path={path} />}
      </div>
    </details>
  );
}

/**
 * Catálogo da API dentro do Super Admin: o documento OpenAPI gerado do código, agrupado por área, com a regra de
 * acesso que o servidor aplica e as métricas de cada rota. Só GET público sem parâmetro obrigatório pode ser executado.
 */
export function AdminApiCatalog() {
  const catalog = useQuery({ queryKey: ["admin", "openapi"], queryFn: adminApi.openapi, staleTime: 60_000 });
  const [filter, setFilter] = useState("");

  const groups = useMemo(() => {
    if (!catalog.data) return [];
    const metrics = new Map(catalog.data.metrics.map((m) => [`${m.method.toLowerCase()} ${normalizeRoute(m.route)}`, m]));
    const operations: Operation[] = [];
    for (const [path, item] of Object.entries(catalog.data.document.paths)) {
      for (const method of METHODS) {
        const op = item[method];
        if (!op) continue;
        const tag = op.tags?.[0] ?? "Outros";
        operations.push({ method, path, tag: TAG_LABEL[tag] ?? tag, op, access: op["x-repbrasil-access"] ?? null, metric: metrics.get(`${method} ${path}`) });
      }
    }
    const term = filter.trim().toLowerCase();
    const visible = term ? operations.filter((o) => `${o.method} ${o.path} ${o.op.summary ?? ""} ${o.tag}`.toLowerCase().includes(term)) : operations;
    const byTag = new Map<string, Operation[]>();
    for (const o of visible) byTag.set(o.tag, [...(byTag.get(o.tag) ?? []), o]);
    return [...byTag.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
  }, [catalog.data, filter]);

  if (!catalog.data) {
    return catalog.isError
      ? <DataState kind="error" title="Catálogo indisponível" action={<RetryButton onRetry={() => void catalog.refetch()} />} />
      : <DataState kind="loading" title="Carregando o catálogo da API" height="h-96" />;
  }
  const total = groups.reduce((sum, [, ops]) => sum + ops.length, 0);

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-body-sm text-fg-muted">
        Documento OpenAPI gerado do código da API em {formatDateTime(catalog.data.generatedAt)}. A regra de acesso de cada rota vem dos
        mesmos atributos que a aplicam no servidor; as métricas contam desde {formatDateTime(catalog.data.metricsSince)}, nesta réplica.
      </p>
      <Field id="admin-api-filter" label="Filtrar rotas" className="max-w-md">
        <input id="admin-api-filter" type="search" className={FIELD_CONTROL} value={filter} onChange={(e) => setFilter(e.target.value)} />
      </Field>
      <p className="text-body-sm text-fg-muted" aria-live="polite">{total} {total === 1 ? "rota" : "rotas"}</p>
      {groups.map(([tag, operations]) => (
        <section key={tag} aria-labelledby={`api-${tag}`}>
          <h2 id={`api-${tag}`} className="border-b border-line-strong pb-1 text-label uppercase text-fg-muted">{tag}</h2>
          {operations.map((o) => <OperationRow key={`${o.method} ${o.path}`} operation={o} doc={catalog.data.document} />)}
        </section>
      ))}
    </div>
  );
}
