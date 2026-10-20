using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RepBrasil.Infrastructure.Persistence;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations;

/// <summary>
/// Administração: trilha de auditoria só de inserção (sem chave estrangeira, para sobreviver à remoção de contas),
/// pedidos de suporte enviados pelo site e o motivo da suspensão de uma conta.
/// </summary>
[DbContext(typeof(ApplicationDbContext))]
[Migration("20261020130000_AddAdminAuditAndSupport")]
public sealed class AddAdminAuditAndSupport : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
            ALTER TABLE account.user_account
                ADD COLUMN disabled_reason text NULL,
                ADD CONSTRAINT ck_user_account_disabled_reason
                    CHECK (disabled_reason IS NULL OR char_length(disabled_reason) BETWEEN 1 AND 300);

            CREATE TABLE account.admin_audit_log (
                id uuid PRIMARY KEY,
                actor_user_id uuid NOT NULL,
                actor_email text NOT NULL,
                action text NOT NULL,
                target_user_id uuid NULL,
                target_label text NULL,
                before jsonb NULL,
                after jsonb NULL,
                context jsonb NOT NULL DEFAULT '{}'::jsonb,
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT ck_admin_audit_action CHECK (action ~ '^[a-z][a-z_.]{2,79}$')
            );
            CREATE INDEX ix_admin_audit_created ON account.admin_audit_log(created_at DESC);
            CREATE INDEX ix_admin_audit_target ON account.admin_audit_log(target_user_id, created_at DESC);
            CREATE INDEX ix_admin_audit_actor ON account.admin_audit_log(actor_user_id, created_at DESC);

            CREATE FUNCTION account.admin_audit_log_append_only() RETURNS trigger
                LANGUAGE plpgsql AS $$
                BEGIN
                    RAISE EXCEPTION 'account.admin_audit_log é só de inserção';
                END
                $$;
            CREATE TRIGGER trg_admin_audit_log_append_only
                BEFORE UPDATE OR DELETE ON account.admin_audit_log
                FOR EACH ROW EXECUTE FUNCTION account.admin_audit_log_append_only();

            CREATE TABLE account.support_request (
                id uuid PRIMARY KEY,
                category text NOT NULL,
                name text NULL,
                email text NOT NULL,
                organization text NULL,
                related_subject text NULL,
                source_reference text NULL,
                message text NOT NULL,
                status text NOT NULL DEFAULT 'novo',
                user_id uuid NULL REFERENCES account.user_account(id) ON DELETE SET NULL,
                ip_hash text NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT ck_support_category CHECK (category IN ('duvida', 'contestacao', 'correcao_de_dado', 'institucional', 'erro_tecnico', 'conta')),
                CONSTRAINT ck_support_status CHECK (status IN ('novo', 'em_analise', 'respondido', 'arquivado')),
                CONSTRAINT ck_support_name CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 120),
                CONSTRAINT ck_support_email CHECK (char_length(email) BETWEEN 3 AND 254 AND position('@' in email) > 1),
                CONSTRAINT ck_support_organization CHECK (organization IS NULL OR char_length(organization) BETWEEN 1 AND 160),
                CONSTRAINT ck_support_related_subject CHECK (related_subject IS NULL OR char_length(related_subject) BETWEEN 1 AND 240),
                CONSTRAINT ck_support_source_reference CHECK (source_reference IS NULL OR char_length(source_reference) BETWEEN 1 AND 500),
                CONSTRAINT ck_support_message CHECK (char_length(message) BETWEEN 30 AND 5000)
            );
            CREATE INDEX ix_support_request_status ON account.support_request(status, created_at DESC);
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
            DROP TABLE IF EXISTS account.support_request;
            DROP TABLE IF EXISTS account.admin_audit_log;
            DROP FUNCTION IF EXISTS account.admin_audit_log_append_only();

            ALTER TABLE account.user_account
                DROP CONSTRAINT IF EXISTS ck_user_account_disabled_reason,
                DROP COLUMN IF EXISTS disabled_reason;
            """);
    }
}
