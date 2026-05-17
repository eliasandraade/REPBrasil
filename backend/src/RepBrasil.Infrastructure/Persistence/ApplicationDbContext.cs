using Microsoft.EntityFrameworkCore;
using RepBrasil.Domain.Entities;

namespace RepBrasil.Infrastructure.Persistence;

public class ApplicationDbContext : DbContext
{
    public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
        : base(options)
    {
    }

    public DbSet<Politician> Politicians => Set<Politician>();
    public DbSet<Party> Parties => Set<Party>();
    public DbSet<Election> Elections => Set<Election>();
    public DbSet<ElectionResult> ElectionResults => Set<ElectionResult>();
    public DbSet<AssetDeclaration> AssetDeclarations => Set<AssetDeclaration>();
    public DbSet<AssetItem> AssetItems => Set<AssetItem>();
    public DbSet<Company> Companies => Set<Company>();
    public DbSet<Contract> Contracts => Set<Contract>();
    public DbSet<Amendment> Amendments => Set<Amendment>();
    public DbSet<Municipality> Municipalities => Set<Municipality>();
    public DbSet<LegalCase> LegalCases => Set<LegalCase>();
    public DbSet<ScoreSnapshot> ScoreSnapshots => Set<ScoreSnapshot>();
    public DbSet<ScoreFactor> ScoreFactors => Set<ScoreFactor>();
    public DbSet<Flag> Flags => Set<Flag>();
    public DbSet<Source> Sources => Set<Source>();
    public DbSet<Evidence> Evidences => Set<Evidence>();
    public DbSet<Contestation> Contestations => Set<Contestation>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Politician>().HasQueryFilter(e => e.DeletedAt == null);
        modelBuilder.Entity<Party>().HasQueryFilter(e => e.DeletedAt == null);
        modelBuilder.Entity<Election>().HasQueryFilter(e => e.DeletedAt == null);
        modelBuilder.Entity<ElectionResult>().HasQueryFilter(e => e.DeletedAt == null);
        modelBuilder.Entity<ElectionResult>()
            .HasIndex(e => new { e.PoliticianId, e.ElectionId, e.Round })
            .IsUnique()
            .HasDatabaseName("IX_ElectionResults_Politician_Election_Round");
        modelBuilder.Entity<AssetDeclaration>().HasQueryFilter(e => e.DeletedAt == null);
        modelBuilder.Entity<AssetDeclaration>()
            .HasIndex(e => new { e.PoliticianId, e.ElectionYear })
            .IsUnique()
            .HasDatabaseName("IX_AssetDeclarations_Politician_Year");

        modelBuilder.Entity<AssetItem>().HasQueryFilter(e => e.DeletedAt == null);
        modelBuilder.Entity<AssetItem>()
            .HasIndex(e => new { e.DeclarationId, e.Order })
            .IsUnique()
            .HasDatabaseName("IX_AssetItems_Declaration_Order");
        modelBuilder.Entity<Company>().HasQueryFilter(e => e.DeletedAt == null);
        modelBuilder.Entity<Contract>().HasQueryFilter(e => e.DeletedAt == null);
        modelBuilder.Entity<Amendment>().HasQueryFilter(e => e.DeletedAt == null);
        modelBuilder.Entity<Municipality>().HasQueryFilter(e => e.DeletedAt == null);
        modelBuilder.Entity<LegalCase>().HasQueryFilter(e => e.DeletedAt == null);
        modelBuilder.Entity<ScoreSnapshot>().HasQueryFilter(e => e.DeletedAt == null);
        modelBuilder.Entity<ScoreFactor>().HasQueryFilter(e => e.DeletedAt == null);
        modelBuilder.Entity<ScoreFactor>()
            .HasOne<ScoreSnapshot>()
            .WithMany(s => s.Factors)
            .HasForeignKey(f => f.ScoreSnapshotId)
            .OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<ScoreFactor>()
            .HasIndex(f => f.ScoreSnapshotId)
            .HasDatabaseName("IX_ScoreFactors_SnapshotId");
        modelBuilder.Entity<Flag>().HasQueryFilter(e => e.DeletedAt == null);
        modelBuilder.Entity<Source>().HasQueryFilter(e => e.DeletedAt == null);
        modelBuilder.Entity<Source>()
            .HasIndex(s => new { s.Name, s.SourceType })
            .IsUnique()
            .HasDatabaseName("IX_Sources_Name_SourceType");
        modelBuilder.Entity<Evidence>().HasQueryFilter(e => e.DeletedAt == null);
        modelBuilder.Entity<Contestation>().HasQueryFilter(e => e.DeletedAt == null);
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        foreach (var entry in ChangeTracker.Entries<AuditableEntity>())
        {
            if (entry.State == EntityState.Modified)
                entry.Entity.UpdatedAt = now;
        }
        return base.SaveChangesAsync(cancellationToken);
    }

    public override int SaveChanges()
    {
        var now = DateTime.UtcNow;
        foreach (var entry in ChangeTracker.Entries<AuditableEntity>())
        {
            if (entry.State == EntityState.Modified)
                entry.Entity.UpdatedAt = now;
        }
        return base.SaveChanges();
    }
}
