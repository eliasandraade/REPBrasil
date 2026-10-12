using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RepBrasil.Infrastructure.Persistence;

#nullable disable

namespace RepBrasil.Infrastructure.Migrations;

[DbContext(typeof(ApplicationDbContext))]
[Migration("20261012180000_AddAccountsAndCommercialApi")]
public sealed class AddAccountsAndCommercialApi : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
            CREATE SCHEMA IF NOT EXISTS account;

            CREATE TABLE account.user_account (
                id uuid PRIMARY KEY,
                email text NOT NULL,
                display_name text NULL,
                avatar_url text NULL,
                email_verified_at timestamptz NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                disabled_at timestamptz NULL,
                CONSTRAINT ck_user_account_email CHECK (email = lower(btrim(email)) AND position('@' in email) > 1)
            );
            CREATE UNIQUE INDEX ux_user_account_email_active
                ON account.user_account (email)
                WHERE disabled_at IS NULL;

            CREATE TABLE account.identity (
                id uuid PRIMARY KEY,
                user_id uuid NOT NULL REFERENCES account.user_account(id) ON DELETE CASCADE,
                provider text NOT NULL,
                provider_subject text NOT NULL,
                provider_email text NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                last_used_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT ck_identity_provider CHECK (provider IN ('magic_link', 'google'))
            );
            CREATE UNIQUE INDEX ux_identity_provider_subject ON account.identity(provider, provider_subject);
            CREATE INDEX ix_identity_user ON account.identity(user_id);

            CREATE TABLE account.login_challenge (
                id uuid PRIMARY KEY,
                kind text NOT NULL,
                email text NULL,
                token_hash text NOT NULL,
                return_to text NOT NULL DEFAULT '/',
                expires_at timestamptz NOT NULL,
                consumed_at timestamptz NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT ck_login_challenge_kind CHECK (kind IN ('magic_link', 'google_state'))
            );
            CREATE UNIQUE INDEX ux_login_challenge_token_hash ON account.login_challenge(token_hash);
            CREATE INDEX ix_login_challenge_expiry ON account.login_challenge(expires_at) WHERE consumed_at IS NULL;

            CREATE TABLE account.session (
                id uuid PRIMARY KEY,
                user_id uuid NOT NULL REFERENCES account.user_account(id) ON DELETE CASCADE,
                token_hash text NOT NULL,
                csrf_token text NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                last_seen_at timestamptz NOT NULL DEFAULT now(),
                expires_at timestamptz NOT NULL,
                revoked_at timestamptz NULL,
                user_agent_hash text NULL,
                ip_prefix_hash text NULL
            );
            CREATE UNIQUE INDEX ux_session_token_hash ON account.session(token_hash);
            CREATE INDEX ix_session_user_active ON account.session(user_id, expires_at) WHERE revoked_at IS NULL;

            CREATE TABLE account.saved_item (
                id uuid PRIMARY KEY,
                user_id uuid NOT NULL REFERENCES account.user_account(id) ON DELETE CASCADE,
                collection text NOT NULL,
                resource_type text NOT NULL,
                resource_key text NOT NULL,
                label text NULL,
                href text NULL,
                metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT ck_saved_item_collection CHECK (collection IN ('favorite', 'watchlist')),
                CONSTRAINT ck_saved_item_resource_type CHECK (resource_type IN ('politician', 'party', 'municipality', 'state', 'election', 'candidacy', 'poll', 'ranking', 'indicator'))
            );
            CREATE UNIQUE INDEX ux_saved_item_identity
                ON account.saved_item(user_id, collection, resource_type, resource_key);
            CREATE INDEX ix_saved_item_user_collection ON account.saved_item(user_id, collection, created_at DESC);

            CREATE TABLE account.alert_subscription (
                id uuid PRIMARY KEY,
                user_id uuid NOT NULL REFERENCES account.user_account(id) ON DELETE CASCADE,
                resource_type text NOT NULL,
                resource_key text NOT NULL,
                event_kind text NOT NULL,
                delivery text NOT NULL DEFAULT 'in_app',
                enabled boolean NOT NULL DEFAULT true,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT ck_alert_delivery CHECK (delivery IN ('in_app', 'email'))
            );
            CREATE UNIQUE INDEX ux_alert_subscription_identity
                ON account.alert_subscription(user_id, resource_type, resource_key, event_kind, delivery);
            CREATE INDEX ix_alert_subscription_dispatch
                ON account.alert_subscription(resource_type, resource_key, event_kind)
                WHERE enabled = true;

            CREATE TABLE account.notification (
                id uuid PRIMARY KEY,
                user_id uuid NOT NULL REFERENCES account.user_account(id) ON DELETE CASCADE,
                event_key text NOT NULL,
                resource_type text NOT NULL,
                resource_key text NOT NULL,
                title text NOT NULL,
                body text NULL,
                href text NULL,
                payload jsonb NOT NULL DEFAULT '{}'::jsonb,
                created_at timestamptz NOT NULL DEFAULT now(),
                read_at timestamptz NULL
            );
            CREATE UNIQUE INDEX ux_notification_event_user ON account.notification(user_id, event_key);
            CREATE INDEX ix_notification_user_created ON account.notification(user_id, created_at DESC);

            CREATE TABLE account.entitlement (
                id uuid PRIMARY KEY,
                user_id uuid NOT NULL REFERENCES account.user_account(id) ON DELETE CASCADE,
                entitlement_key text NOT NULL,
                entitlement_value text NOT NULL,
                source text NOT NULL DEFAULT 'manual',
                starts_at timestamptz NOT NULL DEFAULT now(),
                expires_at timestamptz NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE UNIQUE INDEX ux_entitlement_user_key_source ON account.entitlement(user_id, entitlement_key, source);
            CREATE INDEX ix_entitlement_active ON account.entitlement(user_id, entitlement_key, expires_at);

            CREATE TABLE account.api_key (
                id uuid PRIMARY KEY,
                user_id uuid NOT NULL REFERENCES account.user_account(id) ON DELETE CASCADE,
                name text NOT NULL,
                key_prefix text NOT NULL,
                key_hash text NOT NULL,
                scopes text[] NOT NULL DEFAULT ARRAY['read:public']::text[],
                daily_quota integer NOT NULL DEFAULT 1000,
                created_at timestamptz NOT NULL DEFAULT now(),
                last_used_at timestamptz NULL,
                expires_at timestamptz NULL,
                revoked_at timestamptz NULL,
                CONSTRAINT ck_api_key_daily_quota CHECK (daily_quota > 0)
            );
            CREATE UNIQUE INDEX ux_api_key_hash ON account.api_key(key_hash);
            CREATE INDEX ix_api_key_user_active ON account.api_key(user_id, created_at DESC) WHERE revoked_at IS NULL;

            CREATE TABLE account.api_usage_daily (
                api_key_id uuid NOT NULL REFERENCES account.api_key(id) ON DELETE CASCADE,
                usage_date date NOT NULL,
                request_count integer NOT NULL DEFAULT 0,
                updated_at timestamptz NOT NULL DEFAULT now(),
                PRIMARY KEY (api_key_id, usage_date),
                CONSTRAINT ck_api_usage_nonnegative CHECK (request_count >= 0)
            );
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("DROP SCHEMA IF EXISTS account CASCADE;");
    }
}
