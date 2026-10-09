using Microsoft.EntityFrameworkCore;
using RepBrasil.Domain.Entities.Electoral;

namespace RepBrasil.Infrastructure.Persistence.Electoral;

/// <summary>
/// Mapeamento EF das entidades eleitorais (schema <c>electoral</c>).
/// O schema é criado por SQL versionado (<c>Persistence/Electoral/Sql</c>, aplicado pela
/// migration <c>AddElectoralIntelligence</c>) e escrito pelo ETL Python; por isso as
/// tabelas ficam fora do diff de migrations (<c>ExcludeFromMigrations</c>). Leituras de
/// alto volume (votos, seções) usam SQL explícito em <see cref="ElectoralReadRepository"/>.
/// </summary>
public static class ElectoralModel
{
    public const string Schema = "electoral";

    public static void Configure(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ElectionEvent>(b =>
        {
            b.ToTable("election", Schema, t => t.ExcludeFromMigrations());
            b.HasKey(e => e.Id);
            b.Property(e => e.Id).HasColumnName("id");
            b.Property(e => e.Year).HasColumnName("year");
            b.Property(e => e.Round).HasColumnName("round");
            b.Property(e => e.ElectionDate).HasColumnName("election_date");
            b.Property(e => e.PleitoCode).HasColumnName("pleito_code");
            b.Property(e => e.FederalElectionCode).HasColumnName("federal_election_code");
            b.Property(e => e.StateElectionCode).HasColumnName("state_election_code");
            b.Property(e => e.TseCycle).HasColumnName("tse_cycle");
            b.Property(e => e.Environment).HasColumnName("environment");
            b.Property(e => e.Description).HasColumnName("description");
            b.Property(e => e.CreatedAt).HasColumnName("created_at");
        });

        modelBuilder.Entity<Contest>(b =>
        {
            b.ToTable("contest", Schema, t => t.ExcludeFromMigrations());
            b.HasKey(e => e.Id);
            b.Property(e => e.Id).HasColumnName("id");
            b.Property(e => e.ElectionId).HasColumnName("election_id");
            b.Property(e => e.TseElectionCode).HasColumnName("tse_election_code");
            b.Property(e => e.TseElectionDescription).HasColumnName("tse_election_description");
            b.Property(e => e.OfficeCode).HasColumnName("office_code");
            b.Property(e => e.OfficeName).HasColumnName("office_name");
            b.Property(e => e.Scope).HasColumnName("scope");
            b.Property(e => e.ElectoralUnit).HasColumnName("electoral_unit");
            b.Property(e => e.CreatedAt).HasColumnName("created_at");
            b.HasOne(e => e.Election).WithMany(e => e.Contests).HasForeignKey(e => e.ElectionId);
        });

        modelBuilder.Entity<Candidacy>(b =>
        {
            b.ToTable("candidacy", Schema, t => t.ExcludeFromMigrations());
            b.HasKey(e => e.Id);
            b.Property(e => e.Id).HasColumnName("id");
            b.Property(e => e.ContestId).HasColumnName("contest_id");
            b.Property(e => e.TseCandidateId).HasColumnName("tse_candidate_id");
            b.Property(e => e.CandidateNumber).HasColumnName("candidate_number");
            b.Property(e => e.BallotName).HasColumnName("ballot_name");
            b.Property(e => e.FullName).HasColumnName("full_name");
            b.Property(e => e.SocialName).HasColumnName("social_name");
            b.Property(e => e.AgremiationType).HasColumnName("agremiation_type");
            b.Property(e => e.PartyNumber).HasColumnName("party_number");
            b.Property(e => e.PartyAcronym).HasColumnName("party_acronym");
            b.Property(e => e.PartyName).HasColumnName("party_name");
            b.Property(e => e.FederationNumber).HasColumnName("federation_number");
            b.Property(e => e.FederationAcronym).HasColumnName("federation_acronym");
            b.Property(e => e.FederationName).HasColumnName("federation_name");
            b.Property(e => e.CoalitionName).HasColumnName("coalition_name");
            b.Property(e => e.CandidacyStatusCode).HasColumnName("candidacy_status_code");
            b.Property(e => e.CandidacyStatus).HasColumnName("candidacy_status");
            b.Property(e => e.RoundOutcomeCode).HasColumnName("round_outcome_code");
            b.Property(e => e.RoundOutcome).HasColumnName("round_outcome");
            b.Property(e => e.Elected).HasColumnName("elected");
            b.Property(e => e.PersonId).HasColumnName("person_id");
            b.Property(e => e.PoliticianId).HasColumnName("politician_id");
            b.Property(e => e.IdentityStatus).HasColumnName("identity_status");
            b.Property(e => e.IdentityMethod).HasColumnName("identity_method");
            b.Property(e => e.SourceFileId).HasColumnName("source_file_id");
            b.Property(e => e.IngestionRunId).HasColumnName("ingestion_run_id");
            b.Property(e => e.SourceMember).HasColumnName("source_member");
            b.Property(e => e.SourceLine).HasColumnName("source_line");
            b.Property(e => e.SourceRowHash).HasColumnName("source_row_hash");
            b.Property(e => e.SourceGeneratedAt).HasColumnName("source_generated_at");
            b.Property(e => e.CreatedAt).HasColumnName("created_at");
            b.Property(e => e.UpdatedAt).HasColumnName("updated_at");
            b.HasOne(e => e.Contest).WithMany(e => e.Candidacies).HasForeignKey(e => e.ContestId);
            b.HasOne(e => e.Person).WithMany().HasForeignKey(e => e.PersonId);
            b.HasOne(e => e.Politician).WithMany().HasForeignKey(e => e.PoliticianId);
        });
    }
}
