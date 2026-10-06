/**
 * Synthetic capacity dataset (NFR-010):
 *
 *   100 users · 10 000 opportunities · 100 000 activities and follow-ups
 *   (60 000 activities, 40 000 follow-ups) · 400 organizations ·
 *   3 000 contacts with 15 000 opportunity links · ~4 000 tender cycles ·
 *   2 000 document records · an audit trail of ~110 000 events.
 *
 * Every row satisfies the production constraints and invariants (owner and
 * section agree, every Active nonterminal record has an open follow-up,
 * outcome fields match their stage, one current notice per opportunity).
 * Documents are metadata only — no file bytes — so downloads are excluded
 * from the load mix. Synthetic data only; refuses anything but the local
 * `penta_crm_capacity` database.
 *
 *   npm run capacity:seed
 */
import pg from 'pg';

import { hashPassword } from '../../server/auth/password.js';
import { runMigrations } from '../../server/db/migrate.js';
import { CAPACITY_DATABASE_NAME, assertCapacityTarget, capacityPassword, capacityUrls } from './target.js';

try {
  process.loadEnvFile('.env');
} catch {
  // The environment may be supplied directly.
}

async function ensureDatabase(adminUrl: string): Promise<void> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [CAPACITY_DATABASE_NAME]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${CAPACITY_DATABASE_NAME} OWNER penta_migrator`);
      console.log(`Created database ${CAPACITY_DATABASE_NAME}.`);
    }
  } finally {
    await admin.end();
  }
  // The same lock-down the docker init script applies to dev and test.
  const scoped = new URL(adminUrl);
  scoped.pathname = `/${CAPACITY_DATABASE_NAME}`;
  const client = new pg.Client({ connectionString: scoped.toString() });
  await client.connect();
  try {
    await client.query(`
      REVOKE ALL ON SCHEMA public FROM PUBLIC;
      REVOKE ALL ON DATABASE ${CAPACITY_DATABASE_NAME} FROM PUBLIC;
      GRANT CONNECT ON DATABASE ${CAPACITY_DATABASE_NAME} TO penta_app, penta_migrator;
      ALTER SCHEMA public OWNER TO penta_migrator;
      GRANT USAGE ON SCHEMA public TO penta_app;`);
  } finally {
    await client.end();
  }
}

const GENERATE = `
SELECT setseed(0.42);

-- Sections, accounts (100) -----------------------------------------------
CREATE TEMP TABLE cap_sections AS SELECT n, gen_random_uuid() AS id FROM generate_series(1, 8) n;
INSERT INTO sections (id, name) SELECT id, 'Capacity Section ' || lpad(n::text, 2, '0') FROM cap_sections;

INSERT INTO users (full_name, email, password_hash, role)
  VALUES ('Capacity Administrator', 'cap.admin@example.com', $1, 'admin');
INSERT INTO users (full_name, email, password_hash, role)
  SELECT 'Capacity Manager ' || m, 'cap.management.' || m || '@example.com', $1, 'management' FROM generate_series(1, 4) m;
INSERT INTO users (full_name, email, password_hash, role, section_id, manager_id)
  SELECT 'Capacity Lead ' || n, 'cap.lead.' || n || '@example.com', $1, 'lead', id,
         (SELECT id FROM users WHERE email = 'cap.management.1@example.com')
    FROM cap_sections;
UPDATE sections s SET lead_user_id = u.id FROM users u WHERE u.role = 'lead' AND u.section_id = s.id;
INSERT INTO users (full_name, email, password_hash, role, section_id, manager_id, active)
  SELECT CASE WHEN k % 4 = 0 THEN 'বিক্রয় কর্মকর্তা ' || n || '.' || k ELSE 'Capacity Sales ' || n || '.' || k END,
         'cap.sales.' || n || '.' || k || '@example.com', $1, 'sales', cs.id, l.id, k <= 10
    FROM cap_sections cs
    JOIN users l ON l.section_id = cs.id AND l.role = 'lead'
    CROSS JOIN generate_series(1, 11) k
   WHERE k <= 10 OR n <= 7;

CREATE TEMP TABLE cap_owners AS
  SELECT row_number() OVER (ORDER BY u.email) AS n, u.id, u.section_id, u.active
    FROM users u WHERE u.role IN ('sales', 'lead');
CREATE TEMP TABLE cap_active_owners AS
  SELECT row_number() OVER (ORDER BY id) AS n, id, section_id FROM cap_owners WHERE active;
CREATE TEMP TABLE cap_inactive_owners AS
  SELECT row_number() OVER (ORDER BY id) AS n, id, section_id FROM cap_owners WHERE NOT active;

-- Organizations (400) -------------------------------------------------------
CREATE TEMP TABLE cap_orgs AS SELECT i AS n, gen_random_uuid() AS id FROM generate_series(1, 400) i;
INSERT INTO organizations (id, name, type, location, website)
  SELECT id,
         CASE WHEN n % 5 = 0 THEN 'সরকারি দপ্তর ' || n ELSE 'Capacity Organization ' || lpad(n::text, 3, '0') END,
         (enum_range(NULL::organization_type))[1 + n % 7], 'Dhaka', 'https://org' || n || '.example.gov.bd'
    FROM cap_orgs;
UPDATE organizations o SET parent_id = p.id
  FROM cap_orgs c JOIN cap_orgs p ON p.n = 1 + c.n % 20
 WHERE o.id = c.id AND c.n > 20;

-- Opportunities (10 000) -----------------------------------------------------
CREATE TEMP TABLE cap_opps AS
  SELECT i AS n, gen_random_uuid() AS id,
         CASE WHEN i % 100 < 10 THEN 'awarded'
              WHEN i % 100 < 18 THEN 'lost'
              ELSE (ARRAY['identified','initial_engagement','requirements_discussion','awaiting_tender',
                          'tender_published','bid_preparation','bid_submitted','evaluation'])[1 + (i * 7) % 8] END AS stage,
         CASE WHEN i % 100 BETWEEN 18 AND 25 THEN 'on_hold' WHEN i % 100 BETWEEN 26 AND 29 THEN 'cancelled' ELSE 'active' END AS status
    FROM generate_series(1, 10000) i;
ALTER TABLE cap_opps ADD COLUMN owner_id uuid, ADD COLUMN section_id uuid;
UPDATE cap_opps c SET owner_id = o.id, section_id = o.section_id
  FROM cap_active_owners o WHERE o.n = 1 + c.n % (SELECT count(*) FROM cap_active_owners);
-- Closed records keep some inactive historical owners (BR-051).
UPDATE cap_opps c SET owner_id = o.id, section_id = o.section_id
  FROM cap_inactive_owners o
 WHERE c.stage IN ('awarded', 'lost') AND c.n % 5 = 0 AND o.n = 1 + c.n % (SELECT count(*) FROM cap_inactive_owners);

INSERT INTO opportunities (
  id, reference, name, organization_id, department, solution_category, description, estimated_value,
  funding_source, owner_id, section_id, stage, status, priority, expected_publication_date, expected_award_date,
  awarded_value, award_date, loss_reason, loss_note, closed_date, status_note, created_by, created_at, updated_at)
SELECT c.id,
       'OPP-' || lpad(c.n::text, 6, '0'),
       CASE WHEN c.n % 10 = 3 THEN 'ডিজিটাল সেবা প্রকল্প ' || c.n ELSE 'Capacity Opportunity ' || c.n END,
       org.id, 'ICT Cell',
       (enum_range(NULL::solution_category))[1 + c.n % 7],
       'Synthetic capacity record ' || c.n,
       round((500000 + random() * 90000000)::numeric, 2),
       'Development budget', c.owner_id, c.section_id,
       c.stage::opportunity_stage, c.status::opportunity_status,
       (enum_range(NULL::priority))[1 + c.n % 3],
       CASE WHEN c.n % 9 = 0 THEN NULL ELSE current_date + (c.n % 300) - 120 END,
       CASE WHEN c.n % 9 = 0 THEN NULL ELSE current_date + (c.n % 300) - 60 END,
       CASE WHEN c.stage = 'awarded' THEN round((400000 + random() * 80000000)::numeric, 2) END,
       CASE WHEN c.stage = 'awarded' THEN current_date - (c.n % 400) END,
       CASE WHEN c.stage = 'lost' THEN (ARRAY['price','technical_eligibility','competitor_selected','budget_unavailable','no_bid','other'])[1 + c.n % 6] END,
       CASE WHEN c.stage = 'lost' AND c.n % 6 = 5 THEN 'Synthetic explanation' END,
       CASE WHEN c.stage IN ('awarded', 'lost') THEN current_date - (c.n % 400)
            WHEN c.status = 'cancelled' THEN current_date - (c.n % 200) END,
       CASE WHEN c.status <> 'active' THEN 'Synthetic status note' END,
       c.owner_id,
       now() - make_interval(days => c.n % 730, mins => c.n % 1440),
       now() - make_interval(days => c.n % 30)
  FROM cap_opps c
  JOIN cap_orgs org ON org.n = 1 + (c.n * 13) % 400;
SELECT setval('opportunity_reference_seq', 10000);

-- Follow-ups (40 000): one open next action per working or held record, three
-- completed per record, one cancelled per closed record.
INSERT INTO follow_ups (opportunity_id, title, assigned_user_id, due_date, priority, state, created_by, created_at)
  SELECT c.id, 'Next action ' || c.n, c.owner_id, current_date + (c.n % 40) - 10, 'medium', 'open', c.owner_id, now() - make_interval(days => c.n % 60)
    FROM cap_opps c
   WHERE c.status IN ('active', 'on_hold') AND c.stage NOT IN ('awarded', 'lost');
INSERT INTO follow_ups (opportunity_id, title, assigned_user_id, due_date, priority, state, completed_at, completed_by,
                        completion_note, created_by, created_at)
  SELECT c.id, 'Earlier step ' || k || ' for ' || c.n, c.owner_id, current_date - (c.n % 300) - k * 7, 'medium', 'completed',
         now() - make_interval(days => (c.n % 300) + k * 7), c.owner_id, 'Done', c.owner_id, now() - make_interval(days => (c.n % 300) + k * 7 + 3)
    FROM cap_opps c CROSS JOIN generate_series(1, 3) k;
INSERT INTO follow_ups (opportunity_id, title, assigned_user_id, due_date, priority, state, cancelled_at, cancelled_by,
                        cancellation_reason, created_by, created_at)
  SELECT c.id, 'Closed step for ' || c.n, c.owner_id, current_date - (c.n % 200), 'low', 'cancelled',
         now() - make_interval(days => c.n % 200), c.owner_id, 'Closed automatically: opportunity closed.', c.owner_id,
         now() - make_interval(days => (c.n % 200) + 2)
    FROM cap_opps c
   WHERE c.stage IN ('awarded', 'lost') OR c.status = 'cancelled';

-- Contacts (3 000) and links (15 000) ---------------------------------------
CREATE TEMP TABLE cap_contacts AS SELECT i AS n, gen_random_uuid() AS id FROM generate_series(1, 3000) i;
INSERT INTO contacts (id, organization_id, full_name, designation, email, phone, created_by)
  SELECT c.id, org.id,
         CASE WHEN c.n % 4 = 0 THEN 'মোঃ যোগাযোগ ' || c.n ELSE 'Capacity Contact ' || c.n END,
         'Deputy Director', 'cap.contact.' || c.n || '@example.gov.bd', '+880 1700-' || lpad(c.n::text, 6, '0'),
         (SELECT id FROM users WHERE email = 'cap.management.1@example.com')
    FROM cap_contacts c JOIN cap_orgs org ON org.n = 1 + c.n % 400;
INSERT INTO opportunity_contacts (opportunity_id, contact_id, relationship_notes, created_by)
  SELECT o.id, ct.id, CASE WHEN o.n % 3 = 0 THEN 'Synthetic relationship note' END, o.owner_id
    FROM cap_opps o JOIN cap_contacts ct ON ct.n = 1 + o.n % 3000;
INSERT INTO opportunity_contacts (opportunity_id, contact_id, created_by)
  SELECT o.id, ct.id, o.owner_id
    FROM cap_opps o JOIN cap_contacts ct ON ct.n = 1 + (o.n * 7 + 1500) % 3000
   WHERE o.n % 2 = 0 AND (o.n * 7 + 1500) % 3000 <> o.n % 3000;

-- Activities (60 000) ---------------------------------------------------------
INSERT INTO activities (opportunity_id, occurred_at, type, subject, notes, contact_id, author_id, created_at)
  SELECT o.id, now() - make_interval(days => (o.n * k) % 700, hours => k),
         (enum_range(NULL::activity_type))[1 + (o.n + k) % 6],
         CASE WHEN k = 3 THEN 'সভা ' || o.n ELSE 'Capacity activity ' || k || ' on ' || o.n END,
         'Synthetic notes', CASE WHEN k = 1 THEN ct.id END, o.owner_id,
         now() - make_interval(days => (o.n * k) % 700)
    FROM cap_opps o CROSS JOIN generate_series(1, 6) k
    JOIN cap_contacts ct ON ct.n = 1 + o.n % 3000;

-- Tenders: one current notice for records at tender stages, an earlier
-- superseded cycle for one in ten.
INSERT INTO tenders (opportunity_id, procuring_organization_id, title, reference, publication_date, submission_deadline,
                     bid_status, submitted_at, is_current, notice_state, created_by)
  SELECT o.id, org.id, 'Capacity notice ' || o.n, 'CAP/' || o.n || '/1',
         current_date - 45 + (o.n % 20),
         (current_date + (o.n % 40) - 15)::timestamp AT TIME ZONE 'Asia/Dhaka' + interval '12 hours',
         CASE WHEN o.stage IN ('bid_submitted', 'evaluation') THEN 'submitted'::bid_status
              WHEN o.stage = 'bid_preparation' THEN 'preparing'::bid_status ELSE 'reviewing'::bid_status END,
         CASE WHEN o.stage IN ('bid_submitted', 'evaluation')
              THEN (current_date + (o.n % 40) - 15)::timestamp AT TIME ZONE 'Asia/Dhaka' END,
         true, 'current', o.owner_id
    FROM cap_opps o JOIN cap_orgs org ON org.n = 1 + (o.n * 13) % 400
   WHERE o.stage IN ('tender_published', 'bid_preparation', 'bid_submitted', 'evaluation');
INSERT INTO tenders (opportunity_id, procuring_organization_id, title, reference, publication_date, submission_deadline,
                     bid_status, is_current, notice_state, created_by)
  SELECT o.id, org.id, 'Earlier notice ' || o.n, 'CAP/' || o.n || '/0', current_date - 120,
         (current_date - 90)::timestamp AT TIME ZONE 'Asia/Dhaka', 'reviewing', false, 'superseded', o.owner_id
    FROM cap_opps o JOIN cap_orgs org ON org.n = 1 + (o.n * 13) % 400
   WHERE o.stage IN ('tender_published', 'bid_preparation', 'bid_submitted', 'evaluation') AND o.n % 10 = 0;

-- Documents (2 000, metadata only) -------------------------------------------
CREATE TEMP TABLE cap_docs AS
  SELECT o.n, o.id AS opportunity_id, o.owner_id, gen_random_uuid() AS document_id, gen_random_uuid() AS upload_id
    FROM cap_opps o WHERE o.n % 5 = 0;
INSERT INTO documents (id, opportunity_id, category, created_by)
  SELECT document_id, opportunity_id, (enum_range(NULL::document_category))[1 + n % 6], owner_id FROM cap_docs;
INSERT INTO document_uploads (id, opportunity_id, created_by, file_name, mime_type, byte_size, sha256, storage_key, expires_at, finalized_at)
  SELECT upload_id, opportunity_id, owner_id, 'capacity-' || n || '.pdf', 'application/pdf', 1000 + n, md5(n::text), 'capacity/' || upload_id, now(), now()
    FROM cap_docs;
INSERT INTO document_revisions (document_id, revision_number, upload_id, file_name, mime_type, byte_size, sha256, storage_key,
                                scan_state, scanner, scanned_at, uploaded_by)
  SELECT document_id, 1, upload_id, 'capacity-' || n || '.pdf', 'application/pdf', 1000 + n, md5(n::text), 'capacity/' || upload_id,
         'clean', 'test', now(), owner_id
    FROM cap_docs;

-- Audit trail: one creation event per opportunity, follow-up and activity.
INSERT INTO audit_events (actor_id, opportunity_id, entity_type, entity_id, action, domain, after_data, occurred_at, request_id)
  SELECT created_by, id, 'opportunity', id, 'opportunity.created', 'commercial', jsonb_build_object('name', name), created_at, 'capacity-seed'
    FROM opportunities;
INSERT INTO audit_events (actor_id, opportunity_id, entity_type, entity_id, action, domain, after_data, occurred_at, request_id)
  SELECT created_by, opportunity_id, 'follow_up', id, 'follow_up.created', 'commercial',
         jsonb_build_object('task', title, 'dueDate', due_date), created_at, 'capacity-seed'
    FROM follow_ups;
INSERT INTO audit_events (actor_id, opportunity_id, entity_type, entity_id, action, domain, after_data, occurred_at, request_id)
  SELECT author_id, opportunity_id, 'activity', id, 'activity.logged', 'commercial',
         jsonb_build_object('about', subject, 'type', type), created_at, 'capacity-seed'
    FROM activities;
`;

async function main(): Promise<void> {
  const urls = capacityUrls();
  assertCapacityTarget(urls.migrator);
  assertCapacityTarget(urls.runtime);

  const started = Date.now();
  await ensureDatabase(urls.admin);
  await runMigrations(urls.migrator);

  const client = new pg.Client({ connectionString: urls.migrator });
  await client.connect();
  try {
    const tables = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    await client.query('BEGIN');
    await client.query(`TRUNCATE ${tables.rows.map((row) => `"${row.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    // node-postgres runs one parameterised statement at a time, so the script
    // is split on statement ends and the password hash bound where used.
    const hash = await hashPassword(capacityPassword());
    for (const statement of GENERATE.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
      await client.query(statement, statement.includes('$1') ? [hash] : []);
    }
    await client.query('COMMIT');
    // A settled starting point: no autovacuum catching up during a measurement.
    await client.query('VACUUM (ANALYZE)');

    const counts = await client.query(`
      SELECT (SELECT count(*) FROM users) AS users,
             (SELECT count(*) FROM users WHERE active) AS active_users,
             (SELECT count(*) FROM opportunities) AS opportunities,
             (SELECT count(*) FROM activities) AS activities,
             (SELECT count(*) FROM follow_ups) AS follow_ups,
             (SELECT count(*) FROM organizations) AS organizations,
             (SELECT count(*) FROM contacts) AS contacts,
             (SELECT count(*) FROM opportunity_contacts) AS links,
             (SELECT count(*) FROM tenders) AS tenders,
             (SELECT count(*) FROM documents) AS documents,
             (SELECT count(*) FROM audit_events) AS audit_events,
             (SELECT count(*) FROM opportunities o WHERE o.status = 'active' AND o.stage NOT IN ('awarded','lost')
                AND NOT EXISTS (SELECT 1 FROM follow_ups f WHERE f.opportunity_id = o.id AND f.state = 'open')) AS missing_next_action,
             (SELECT count(*) FROM opportunities o JOIN users u ON u.id = o.owner_id WHERE u.section_id <> o.section_id) AS owner_section_mismatch,
             pg_size_pretty(pg_database_size(current_database())) AS size`);
    console.log(JSON.stringify(counts.rows[0], null, 2));
    console.log(`Capacity dataset ready in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('Capacity seed failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
