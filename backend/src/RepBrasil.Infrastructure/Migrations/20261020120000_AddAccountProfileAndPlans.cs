using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RepBrasil.Infrastructure.Persistence;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations;

/// <summary>
/// Perfil da conta, assinaturas, pastas de itens salvos e o registro das edições oficiais que geram alertas.
/// O perfil guarda só o necessário ao produto: nada de CPF, partido, candidato, ideologia, religião ou intenção
/// de voto. Planos e capabilities não ficam no banco: o catálogo é código (<c>PlanCatalog</c>); aqui só há o
/// vínculo de cada conta com um plano pago.
/// </summary>
[DbContext(typeof(ApplicationDbContext))]
[Migration("20261020120000_AddAccountProfileAndPlans")]
public sealed class AddAccountProfileAndPlans : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
            ALTER TABLE account.user_account
                ADD COLUMN full_name text NULL,
                ADD COLUMN state_code text NULL,
                ADD COLUMN municipality_ibge_code text NULL,
                ADD COLUMN usage_type text NULL,
                ADD COLUMN avatar_hidden boolean NOT NULL DEFAULT false,
                ADD COLUMN profile_customized_at timestamptz NULL,
                ADD CONSTRAINT ck_user_account_full_name
                    CHECK (full_name IS NULL OR char_length(full_name) BETWEEN 1 AND 120),
                ADD CONSTRAINT ck_user_account_state_code
                    CHECK (state_code IS NULL OR state_code ~ '^[A-Z]{2}$'),
                ADD CONSTRAINT ck_user_account_municipality
                    CHECK (municipality_ibge_code IS NULL OR (municipality_ibge_code ~ '^[0-9]{7}$' AND state_code IS NOT NULL)),
                ADD CONSTRAINT ck_user_account_usage_type
                    CHECK (usage_type IS NULL OR usage_type IN (
                        'eleitor', 'estudante_pesquisador', 'jornalista', 'assessor_politico', 'servidor_publico', 'outro'));

            CREATE TABLE account.subscription (
                id uuid PRIMARY KEY,
                user_id uuid NOT NULL REFERENCES account.user_account(id) ON DELETE CASCADE,
                plan text NOT NULL,
                status text NOT NULL,
                provider text NOT NULL DEFAULT 'manual',
                provider_reference text NULL,
                current_period_end timestamptz NULL,
                cancel_at_period_end boolean NOT NULL DEFAULT false,
                notes text NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                canceled_at timestamptz NULL,
                CONSTRAINT ck_subscription_plan CHECK (plan IN ('ADVANCED', 'PROFESSIONAL')),
                CONSTRAINT ck_subscription_status CHECK (status IN ('active', 'past_due', 'canceled', 'expired')),
                CONSTRAINT ck_subscription_provider CHECK (provider IN ('manual')),
                CONSTRAINT ck_subscription_notes CHECK (notes IS NULL OR char_length(notes) <= 500)
            );
            CREATE UNIQUE INDEX ux_subscription_user_live
                ON account.subscription(user_id)
                WHERE status IN ('active', 'past_due');
            CREATE INDEX ix_subscription_user_recent ON account.subscription(user_id, created_at DESC);
            CREATE INDEX ix_subscription_status ON account.subscription(status, updated_at DESC);

            ALTER TABLE account.saved_item
                ADD COLUMN folder text NULL,
                ADD CONSTRAINT ck_saved_item_folder
                    CHECK (folder IS NULL OR (folder = btrim(folder) AND char_length(folder) BETWEEN 1 AND 60));

            CREATE TABLE account.alert_edition (
                event_key text PRIMARY KEY,
                event_kind text NOT NULL,
                resource_type text NOT NULL,
                resource_key text NOT NULL,
                title text NOT NULL,
                body text NULL,
                href text NULL,
                payload jsonb NOT NULL DEFAULT '{}'::jsonb,
                first_seen_at timestamptz NOT NULL DEFAULT now(),
                fanned_out_at timestamptz NULL,
                CONSTRAINT ck_alert_edition_event_key CHECK (char_length(event_key) BETWEEN 1 AND 160)
            );
            CREATE INDEX ix_alert_edition_pending ON account.alert_edition(first_seen_at) WHERE fanned_out_at IS NULL;

            -- Primeiro ciclo do publicador: o histórico existente vira linha de base, sem aviso a ninguém.
            CREATE TABLE account.alert_publisher_state (
                id smallint PRIMARY KEY CHECK (id = 1),
                baseline_at timestamptz NOT NULL DEFAULT now()
            );
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
            DROP TABLE IF EXISTS account.alert_publisher_state;
            DROP TABLE IF EXISTS account.alert_edition;

            ALTER TABLE account.saved_item
                DROP CONSTRAINT IF EXISTS ck_saved_item_folder,
                DROP COLUMN IF EXISTS folder;

            DROP TABLE IF EXISTS account.subscription;

            ALTER TABLE account.user_account
                DROP CONSTRAINT IF EXISTS ck_user_account_usage_type,
                DROP CONSTRAINT IF EXISTS ck_user_account_municipality,
                DROP CONSTRAINT IF EXISTS ck_user_account_state_code,
                DROP CONSTRAINT IF EXISTS ck_user_account_full_name,
                DROP COLUMN IF EXISTS profile_customized_at,
                DROP COLUMN IF EXISTS avatar_hidden,
                DROP COLUMN IF EXISTS usage_type,
                DROP COLUMN IF EXISTS municipality_ibge_code,
                DROP COLUMN IF EXISTS state_code,
                DROP COLUMN IF EXISTS full_name;
            """);
    }
}
