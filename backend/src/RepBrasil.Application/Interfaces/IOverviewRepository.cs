using RepBrasil.Application.Overview;

namespace RepBrasil.Application.Interfaces;

/// <summary>Números de cobertura da plataforma (pleitos importados, fontes oficiais). Pequeno; o repositório pode manter em cache.</summary>
public interface IOverviewRepository
{
    Task<OverviewData> OverviewAsync(CancellationToken ct);
}
