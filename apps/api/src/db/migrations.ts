/**
 * Schema migrations, applied in order and recorded by Kysely's migrator. Raw DDL so the MySQL
 * specifics (InnoDB, utf8mb4, BIGINT cents, CHECK constraints, triggers) are explicit.
 */
import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

const statements =
  (...ddl: string[]) =>
  async (db: Kysely<unknown>) => {
    for (const s of ddl) await sql.raw(s).execute(db);
  };

const T = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin";

export const migrations: Record<string, Migration> = {
  "001_core": {
    up: statements(
      `CREATE TABLE tenants (id CHAR(26) PRIMARY KEY, name VARCHAR(200) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ${T}`,
      `CREATE TABLE funds (
        id CHAR(26) PRIMARY KEY, tenant_id CHAR(26) NOT NULL, name VARCHAR(200) NOT NULL, currency CHAR(3) NOT NULL,
        kind ENUM('master','feeder','parallel') NOT NULL, master_fund_id CHAR(26) NULL,
        fee_rate_bps INT NOT NULL, investment_period_end DATE NOT NULL, default_notice_days INT NOT NULL,
        hurdle_bps INT NOT NULL, carry_bps INT NOT NULL, equalisation_rate_bps INT NOT NULL, first_close_date DATE NOT NULL,
        iban VARCHAR(34) NOT NULL, bic VARCHAR(11) NOT NULL,
        version INT NOT NULL DEFAULT 0, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        KEY ix_funds_tenant (tenant_id),
        CONSTRAINT ck_funds_rates CHECK (fee_rate_bps BETWEEN 0 AND 10000 AND carry_bps BETWEEN 0 AND 9999 AND hurdle_bps >= 0)
      ) ${T}`,
      `CREATE TABLE investors (
        id CHAR(26) PRIMARY KEY, tenant_id CHAR(26) NOT NULL, name VARCHAR(200) NOT NULL,
        kind ENUM('individual','institution','feeder') NOT NULL, country CHAR(2) NOT NULL,
        kyc_status ENUM('pending','verified','expired') NOT NULL, iban VARCHAR(34) NOT NULL, bic VARCHAR(11) NOT NULL,
        feeder_fund_id CHAR(26) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        KEY ix_investors_tenant (tenant_id)
      ) ${T}`,
      `CREATE TABLE commitments (
        id CHAR(26) PRIMARY KEY, tenant_id CHAR(26) NOT NULL, fund_id CHAR(26) NOT NULL, investor_id CHAR(26) NOT NULL,
        amount BIGINT NOT NULL, admitted DATE NOT NULL, closing_id CHAR(26) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY uq_commitment (tenant_id, fund_id, investor_id), CONSTRAINT ck_commitment CHECK (amount > 0)
      ) ${T}`,
      `CREATE TABLE closings (
        id CHAR(26) PRIMARY KEY, tenant_id CHAR(26) NOT NULL, fund_id CHAR(26) NOT NULL, close_date DATE NOT NULL,
        status ENUM('draft','completed','cancelled') NOT NULL, admissions JSON NOT NULL, event_id CHAR(26) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), KEY ix_closings (tenant_id, fund_id)
      ) ${T}`,
      `CREATE TABLE side_letters (
        id CHAR(26) PRIMARY KEY, tenant_id CHAR(26) NOT NULL, fund_id CHAR(26) NOT NULL, investor_id CHAR(26) NOT NULL,
        title VARCHAR(300) NOT NULL, body MEDIUMTEXT NOT NULL, sha256 CHAR(64) NOT NULL,
        status ENUM('extracting','in_review','reviewed') NOT NULL, uploaded_by VARCHAR(100) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), KEY ix_side_letters (tenant_id, fund_id),
        UNIQUE KEY uq_side_letter (tenant_id, fund_id, sha256)
      ) ${T}`,
      `CREATE TABLE provisions (
        id CHAR(26) PRIMARY KEY, tenant_id CHAR(26) NOT NULL, fund_id CHAR(26) NOT NULL, investor_id CHAR(26) NOT NULL,
        side_letter_id CHAR(26) NULL, source ENUM('side_letter','mfn_election') NOT NULL,
        type VARCHAR(40) NOT NULL, params JSON NOT NULL, category VARCHAR(40) NOT NULL,
        quote TEXT NULL, quote_start INT NULL, quote_end INT NULL, extractor VARCHAR(60) NOT NULL,
        status ENUM('proposed','approved','rejected') NOT NULL, elected_from CHAR(26) NULL,
        proposed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), decided_by VARCHAR(100) NULL, decided_at DATETIME(3) NULL,
        KEY ix_provisions (tenant_id, fund_id, status), KEY ix_provisions_investor (tenant_id, investor_id)
      ) ${T}`,
      `CREATE TABLE mfn_elections (
        id CHAR(26) PRIMARY KEY, tenant_id CHAR(26) NOT NULL, fund_id CHAR(26) NOT NULL, investor_id CHAR(26) NOT NULL,
        eligible JSON NOT NULL, elected JSON NOT NULL, status ENUM('open','submitted') NOT NULL,
        opened_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), submitted_at DATETIME(3) NULL,
        UNIQUE KEY uq_mfn (tenant_id, fund_id, investor_id)
      ) ${T}`,
      `CREATE TABLE capital_events (
        id CHAR(26) PRIMARY KEY, tenant_id CHAR(26) NOT NULL, fund_id CHAR(26) NOT NULL,
        kind ENUM('call','distribution','equalisation') NOT NULL, reference VARCHAR(40) NOT NULL,
        status ENUM('draft','calculated','approved','issued','settled','cancelled') NOT NULL,
        issue_date DATE NOT NULL, input JSON NOT NULL, result_hash CHAR(64) NULL, error JSON NULL,
        created_by VARCHAR(100) NOT NULL, version INT NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), calculated_at DATETIME(3) NULL, issued_at DATETIME(3) NULL,
        UNIQUE KEY uq_event_ref (tenant_id, fund_id, reference), KEY ix_events (tenant_id, fund_id, status)
      ) ${T}`,
      `CREATE TABLE event_lines (
        tenant_id CHAR(26) NOT NULL, event_id CHAR(26) NOT NULL, investor_id CHAR(26) NOT NULL,
        components JSON NOT NULL, total BIGINT NOT NULL, due_date DATE NULL, detail JSON NOT NULL,
        paid BIGINT NOT NULL DEFAULT 0, status ENUM('open','partial','paid','overpaid','nothing_due') NOT NULL,
        end_to_end_id VARCHAR(35) NOT NULL,
        PRIMARY KEY (event_id, investor_id), KEY ix_lines_tenant (tenant_id, investor_id),
        UNIQUE KEY uq_e2e (tenant_id, end_to_end_id)
      ) ${T}`,
      `CREATE TABLE approvals (
        tenant_id CHAR(26) NOT NULL, event_id CHAR(26) NOT NULL, user_id VARCHAR(100) NOT NULL, result_hash CHAR(64) NOT NULL,
        decided_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (event_id, user_id), KEY ix_approvals (tenant_id)
      ) ${T}`,
      `CREATE TABLE journal (
        id CHAR(26) PRIMARY KEY, tenant_id CHAR(26) NOT NULL, fund_id CHAR(26) NOT NULL, event_id CHAR(26) NULL,
        kind VARCHAR(40) NOT NULL, booked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), description VARCHAR(300) NOT NULL,
        KEY ix_journal (tenant_id, fund_id)
      ) ${T}`,
      `CREATE TABLE postings (
        tenant_id CHAR(26) NOT NULL, journal_id CHAR(26) NOT NULL, seq INT NOT NULL, fund_id CHAR(26) NOT NULL,
        account VARCHAR(64) NOT NULL, investor_id VARCHAR(26) NOT NULL DEFAULT '', amount BIGINT NOT NULL,
        PRIMARY KEY (journal_id, seq), KEY ix_postings (tenant_id, fund_id, account, investor_id)
      ) ${T}`,
      `CREATE TABLE account_balances (
        tenant_id CHAR(26) NOT NULL, fund_id CHAR(26) NOT NULL, account VARCHAR(64) NOT NULL,
        investor_id VARCHAR(26) NOT NULL DEFAULT '', balance BIGINT NOT NULL,
        PRIMARY KEY (tenant_id, fund_id, account, investor_id)
      ) ${T}`,
      `CREATE TABLE bank_statements (
        id CHAR(26) PRIMARY KEY, tenant_id CHAR(26) NOT NULL, msg_id VARCHAR(35) NOT NULL, sha256 CHAR(64) NOT NULL,
        received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), entries INT NOT NULL,
        UNIQUE KEY uq_statement (tenant_id, msg_id)
      ) ${T}`,
      `CREATE TABLE bank_entries (
        id CHAR(26) PRIMARY KEY, tenant_id CHAR(26) NOT NULL, statement_id CHAR(26) NOT NULL, acct_svcr_ref VARCHAR(60) NOT NULL,
        amount BIGINT NOT NULL, booking_date DATE NOT NULL, end_to_end_id VARCHAR(35) NULL, remittance VARCHAR(140) NULL,
        debtor_name VARCHAR(140) NULL, debtor_iban VARCHAR(34) NULL, event_id CHAR(26) NULL, investor_id CHAR(26) NULL,
        status ENUM('matched','unmatched','duplicate','resolved') NOT NULL, note VARCHAR(300) NULL,
        KEY ix_entries (tenant_id, status), KEY ix_entries_ref (tenant_id, acct_svcr_ref)
      ) ${T}`,
      `CREATE TABLE payment_files (
        id CHAR(26) PRIMARY KEY, tenant_id CHAR(26) NOT NULL, event_id CHAR(26) NOT NULL, msg_id VARCHAR(35) NOT NULL,
        xml MEDIUMTEXT NOT NULL, sha256 CHAR(64) NOT NULL, transactions INT NOT NULL, control_sum BIGINT NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE KEY uq_payment_file (tenant_id, event_id)
      ) ${T}`,
      `CREATE TABLE notices (
        id CHAR(26) PRIMARY KEY, tenant_id CHAR(26) NOT NULL, event_id CHAR(26) NOT NULL, investor_id CHAR(26) NOT NULL,
        kind VARCHAR(30) NOT NULL, html MEDIUMTEXT NOT NULL, sha256 CHAR(64) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE KEY uq_notice (tenant_id, event_id, investor_id),
        KEY ix_notices_investor (tenant_id, investor_id)
      ) ${T}`,
      `CREATE TABLE audit_log (
        tenant_id CHAR(26) NOT NULL, seq BIGINT NOT NULL, at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        actor VARCHAR(100) NOT NULL, action VARCHAR(60) NOT NULL, entity VARCHAR(40) NOT NULL, entity_id VARCHAR(40) NOT NULL,
        payload JSON NOT NULL, prev_hash CHAR(64) NOT NULL, hash CHAR(64) NOT NULL, PRIMARY KEY (tenant_id, seq)
      ) ${T}`,
      // the audit log is append-only: the database refuses updates and deletes, whoever asks
      `CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log FOR EACH ROW
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only'`,
      `CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log FOR EACH ROW
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log is append-only'`,
      `CREATE TRIGGER postings_no_update BEFORE UPDATE ON postings FOR EACH ROW
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'postings are immutable; post a reversal'`,
      `CREATE TRIGGER postings_no_delete BEFORE DELETE ON postings FOR EACH ROW
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'postings are immutable; post a reversal'`,
      `CREATE TABLE outbox (
        id CHAR(26) PRIMARY KEY, tenant_id CHAR(26) NOT NULL, topic VARCHAR(60) NOT NULL, payload JSON NOT NULL,
        status ENUM('pending','done','failed') NOT NULL, attempts INT NOT NULL DEFAULT 0, last_error VARCHAR(500) NULL,
        available_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), processed_at DATETIME(3) NULL,
        KEY ix_outbox_pick (status, available_at)
      ) ${T}`,
      `CREATE TABLE idempotency_keys (
        tenant_id CHAR(26) NOT NULL, idem_key VARCHAR(100) NOT NULL, request_hash CHAR(64) NOT NULL, status_code INT NOT NULL,
        response JSON NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (tenant_id, idem_key)
      ) ${T}`,
    ),
  },
};
