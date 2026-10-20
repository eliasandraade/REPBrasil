import type { PlanCode } from "@/lib/account";
import { capabilityValue, formatMonthlyPrice, type CapabilityDefinition, type PlanDefinition, type PlansCatalog } from "@/lib/plans";

function groupsOf(capabilities: readonly CapabilityDefinition[]): Array<[string, CapabilityDefinition[]]> {
  const groups = new Map<string, CapabilityDefinition[]>();
  for (const capability of capabilities) groups.set(capability.group, [...(groups.get(capability.group) ?? []), capability]);
  return [...groups];
}

function Price({ plan }: Readonly<{ plan: PlanDefinition }>) {
  return (
    <p className="mt-2 whitespace-nowrap text-fg">
      <span className="text-heading-md tabular-nums">{formatMonthlyPrice(plan.monthlyPriceCents)}</span>
      <span className="text-body-sm text-fg-muted"> / mês</span>
    </p>
  );
}

function Value({ plan, capability }: Readonly<{ plan: PlanDefinition; capability: CapabilityDefinition }>) {
  const value = capabilityValue(plan, capability);
  if (capability.kind === "limit") return <span className="tabular-nums text-fg">{value.text}</span>;
  return value.included ? (
    <span className="font-medium text-fg">Incluído</span>
  ) : (
    <span className="text-fg-muted">
      <span aria-hidden="true">—</span>
      <span className="sr-only">Não incluído</span>
    </span>
  );
}

function PlanHeading({ plan, current }: Readonly<{ plan: PlanDefinition; current: boolean }>) {
  return (
    <>
      <p className="h-4 text-label uppercase text-accent-text">{plan.recommended ? "Recomendado" : ""}</p>
      <p className="mt-1 text-heading-sm text-fg">{plan.name}</p>
      <Price plan={plan} />
      <p className="mt-3 text-body-sm font-normal leading-relaxed text-fg-soft">{plan.summary}</p>
      <p className="mt-2 text-micro font-normal text-fg-muted">{plan.audience}</p>
      {current && <p className="mt-3 text-label uppercase text-fg">Seu plano</p>}
    </>
  );
}

/**
 * Comparação dos planos lida do catálogo da API: tabela no desktop, um bloco por plano no celular. O plano
 * recomendado ganha hierarquia (faixa e fundo sutil), não brilho; o plano atual da conta é marcado por texto.
 */
export function PlanComparison({ catalog, currentPlan }: Readonly<{ catalog: PlansCatalog; currentPlan?: PlanCode | null }>) {
  const plans = [...catalog.plans].sort((a, b) => a.rank - b.rank);
  const groups = groupsOf(catalog.capabilities);
  const column = (plan: PlanDefinition) => (plan.recommended ? "bg-subtle" : "");

  return (
    <div>
      <table className="hidden w-full table-fixed border-collapse text-left lg:table">
        <caption className="sr-only">Comparação dos planos do REPBrasil: preço mensal, recursos e limites</caption>
        <colgroup>
          <col className="w-[28%]" />
          {plans.map((plan) => (
            <col key={plan.code} className={column(plan)} />
          ))}
        </colgroup>
        <thead>
          <tr className="align-top">
            <th scope="col" className="border-b border-line align-bottom pb-6 text-left text-label font-normal uppercase text-fg-muted">
              <span className="sr-only">Recurso</span>
            </th>
            {plans.map((plan) => (
              <th
                key={plan.code}
                scope="col"
                className={`border-b border-line px-5 pb-6 pt-5 font-normal ${plan.recommended ? "border-t-2 border-t-action" : "border-t-2 border-t-transparent"}`}
              >
                <PlanHeading plan={plan} current={plan.code === currentPlan} />
              </th>
            ))}
          </tr>
        </thead>
        {groups.map(([group, capabilities]) => (
          <tbody key={group}>
            <tr>
              <th scope="colgroup" colSpan={plans.length + 1} className="pb-2 pt-6 text-label uppercase text-fg-muted">
                {group}
              </th>
            </tr>
            {capabilities.map((capability) => (
              <tr key={capability.key} className="border-t border-line align-top">
                <th scope="row" className="py-3 pr-4 font-normal">
                  <span className="block text-body-sm text-fg">{capability.label}</span>
                  <span className="mt-0.5 block text-micro text-fg-muted">{capability.description}</span>
                </th>
                {plans.map((plan) => (
                  <td key={plan.code} className="px-5 py-3 text-body-sm">
                    <Value plan={plan} capability={capability} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>

      <div className="max-w-xl space-y-8 lg:hidden">
        {plans.map((plan) => (
          <section
            key={plan.code}
            aria-label={`Plano ${plan.name}`}
            className={`border-t-2 px-1 pt-4 ${plan.recommended ? "border-t-action bg-subtle px-4 pb-4" : "border-t-line"}`}
          >
            <PlanHeading plan={plan} current={plan.code === currentPlan} />
            <dl className="mt-4 divide-y divide-line border-t border-line">
              {catalog.capabilities.map((capability) => (
                <div key={capability.key} className="flex items-baseline justify-between gap-4 py-2.5 text-body-sm">
                  <dt className="text-fg-soft">{capability.label}</dt>
                  <dd className="text-right">
                    <Value plan={plan} capability={capability} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}

/** O que é de todos, em qualquer plano: o dado público essencial nunca fica atrás de pagamento. */
export function PublicBaseline({ items }: Readonly<{ items: readonly string[] }>) {
  return (
    <section aria-labelledby="public-baseline">
      <h2 id="public-baseline" className="text-label uppercase text-fg-muted">Em qualquer plano, sem pagar</h2>
      <ul className="mt-3 grid gap-x-8 gap-y-2 text-body-sm text-fg-soft sm:grid-cols-2">
        {items.map((item) => (
          <li key={item} className="border-l-2 border-line pl-3">{item}</li>
        ))}
      </ul>
    </section>
  );
}
