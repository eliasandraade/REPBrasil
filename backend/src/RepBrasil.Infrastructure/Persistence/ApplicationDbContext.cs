using Microsoft.EntityFrameworkCore;
using RepBrasil.Domain.Entities;

namespace RepBrasil.Infrastructure.Persistence;

public class ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
    : DbContext(options)
{
    public DbSet<Politician> Politicians => Set<Politician>();
    public DbSet<Party> Parties => Set<Party>();
    public DbSet<Election> Elections => Set<Election>();
    public DbSet<ElectionResult> ElectionResults => Set<ElectionResult>();
    public DbSet<AssetDeclaration> AssetDeclarations => Set<AssetDeclaration>();
    public DbSet<Company> Companies => Set<Company>();
    public DbSet<Contract> Contracts => Set<Contract>();
    public DbSet<Amendment> Amendments => Set<Amendment>();
    public DbSet<Municipality> Municipalities => Set<Municipality>();
    public DbSet<LegalCase> LegalCases => Set<LegalCase>();
    public DbSet<ScoreSnapshot> ScoreSnapshots => Set<ScoreSnapshot>();
    public DbSet<Flag> Flags => Set<Flag>();
    public DbSet<Source> Sources => Set<Source>();
    public DbSet<Evidence> Evidences => Set<Evidence>();
    public DbSet<Contestation> Contestations => Set<Contestation>();
}
