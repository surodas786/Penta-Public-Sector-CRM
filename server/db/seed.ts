/**
 * Loads the synthetic fixtures into a development or test database.
 *
 *   npm run db:seed        -> development database
 *   npm run db:seed:test   -> test database
 *
 * Guards (plan 7.2): refuses NODE_ENV=production, refuses a database whose name
 * is not an explicit development/test name, and refuses a non-local host unless
 * the operator opts in. Connects with the migration role, because seeding is an
 * administrative setup action, not ordinary application execution.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { hashPassword } from '../auth/password.js';
import * as schema from './schema.js';
import {
  activities,
  contacts,
  followUps,
  opportunities,
  opportunityContacts,
  organizations,
  sections,
  tenders,
  users,
} from './schema.js';
import { seedActivities, seedContactLinks, seedContacts } from './seedDirectory.js';
import { seedTenders } from './seedTenders.js';
import {
  legacyUuid,
  seedOpportunities,
  seedOrganizations,
  seedSections,
  seedUsers,
} from './seedData.js';

const ALLOWED_DATABASE_NAMES = new Set(['penta_crm_dev', 'penta_crm_test']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres', 'db']);

export interface SeedGuardResult {
  connectionString: string;
  databaseName: string;
}

export function assertSeedTargetIsSafe(connectionString: string): SeedGuardResult {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed: NODE_ENV=production. Synthetic data is never loaded into production.');
  }

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error('The seed target connection string is not a valid URL.');
  }

  const databaseName = parsed.pathname.replace(/^\//, '');
  if (!ALLOWED_DATABASE_NAMES.has(databaseName)) {
    throw new Error(
      `Refusing to seed database "${databaseName}". ` +
        `Only ${[...ALLOWED_DATABASE_NAMES].join(' and ')} may receive synthetic fixtures.`,
    );
  }

  if (!LOCAL_HOSTS.has(parsed.hostname) && process.env.ALLOW_REMOTE_SEED !== 'true') {
    throw new Error(
      `Refusing to seed a non-local host ("${parsed.hostname}"). ` +
        'Set ALLOW_REMOTE_SEED=true only for a disposable environment you control.',
    );
  }

  return { connectionString, databaseName };
}

export interface SeedSummary {
  databaseName: string;
  sections: number;
  users: number;
  organizations: number;
  opportunities: number;
  followUps: number;
  contacts: number;
  contactLinks: number;
  activities: number;
  tenders: number;
}

export interface SeedOptions {
  /**
   * Reuse an argon2 hash instead of deriving one. The integration suite reseeds
   * before every test; recomputing the hash each time would dominate the run.
   */
  passwordHash?: string;
}

export async function seedDatabase(
  connectionString: string,
  options: SeedOptions = {},
): Promise<SeedSummary> {
  const { databaseName } = assertSeedTargetIsSafe(connectionString);

  const password = process.env.SEED_DEFAULT_PASSWORD?.trim();
  if (!password || password.length < 8) {
    throw new Error(
      'SEED_DEFAULT_PASSWORD must be set (at least 8 characters). It is read from configuration, ' +
        'never hard-coded, and applies to synthetic accounts only.',
    );
  }

  const pool = new pg.Pool({ connectionString, max: 1, application_name: 'penta-crm-seed' });
  const db = drizzle(pool, { schema });

  try {
    const passwordHash = options.passwordHash ?? (await hashPassword(password));
    const createdAtFor = (day: string) => new Date(`${day}T10:30:00+06:00`);

    return await db.transaction(async (tx) => {
      // Order matters: children first. TRUNCATE ... CASCADE is avoided so an
      // unexpected foreign key surfaces instead of being silently cleared.
      await tx.execute(sql`
        TRUNCATE TABLE
          document_revisions, document_uploads, documents, tenders,
          activities, opportunity_contacts, contacts, account_tokens, audit_events,
          idempotency_records, follow_ups, opportunities,
          organizations, users, sections, session
        RESTART IDENTITY CASCADE
      `);
      await tx.execute(sql`ALTER SEQUENCE opportunity_reference_seq RESTART WITH 1`);

      await tx.insert(sections).values(
        seedSections.map((section) => ({
          id: legacyUuid(section.legacyId),
          name: section.name,
          leadUserId: null,
          active: section.active,
        })),
      );

      await tx.insert(users).values(
        seedUsers.map((user) => ({
          id: legacyUuid(user.legacyId),
          fullName: user.fullName,
          email: user.email.toLowerCase(),
          passwordHash,
          role: user.role,
          sectionId: user.sectionLegacyId ? legacyUuid(user.sectionLegacyId) : null,
          managerId: user.managerLegacyId ? legacyUuid(user.managerLegacyId) : null,
          active: user.active,
        })),
      );

      // Set each section's lead now that the users exist.
      for (const section of seedSections) {
        await tx
          .update(sections)
          .set({ leadUserId: legacyUuid(section.leadLegacyId) })
          .where(sql`${sections.id} = ${legacyUuid(section.legacyId)}`);
      }

      // Parents before children so the self-referencing key resolves.
      const roots = seedOrganizations.filter((org) => org.parentLegacyId === null);
      const children = seedOrganizations.filter((org) => org.parentLegacyId !== null);
      for (const batch of [roots, children]) {
        if (batch.length === 0) continue;
        await tx.insert(organizations).values(
          batch.map((org) => ({
            id: legacyUuid(org.legacyId),
            name: org.name,
            type: org.type,
            parentId: org.parentLegacyId ? legacyUuid(org.parentLegacyId) : null,
            location: org.location,
            website: org.website,
            basicNotes: org.basicNotes,
          })),
        );
      }

      await tx.insert(opportunities).values(
        seedOpportunities.map((opp) => ({
          id: legacyUuid(opp.legacyId),
          reference: `OPP-${String(Number(opp.legacyId.replace(/\D/g, '')) + 900000).padStart(6, '0')}`,
          name: opp.name,
          organizationId: legacyUuid(opp.organizationLegacyId),
          department: opp.department,
          solutionCategory: opp.solutionCategory,
          description: opp.description,
          estimatedValue: opp.estimatedValue,
          fundingSource: opp.fundingSource ?? null,
          ownerId: legacyUuid(opp.ownerLegacyId),
          sectionId: legacyUuid(opp.sectionLegacyId),
          stage: opp.stage,
          status: opp.status,
          priority: opp.priority,
          expectedPublicationDate: opp.expectedPublicationDate ?? null,
          expectedAwardDate: opp.expectedAwardDate ?? null,
          awardedValue: opp.awardedValue ?? null,
          awardDate: opp.awardDate ?? null,
          lossReason: opp.lossReason ?? null,
          closedDate: opp.closedDate ?? null,
          statusNote: opp.statusNote ?? null,
          createdBy: legacyUuid(opp.ownerLegacyId),
          createdAt: createdAtFor(opp.createdOn),
          updatedAt: createdAtFor(opp.createdOn),
        })),
      );

      // D-003: the demo's next-action text becomes the one open follow-up.
      const followUpRows = seedOpportunities
        .filter((opp) => opp.nextAction)
        .map((opp) => ({
          opportunityId: legacyUuid(opp.legacyId),
          title: opp.nextAction!.title,
          assignedUserId: legacyUuid(opp.ownerLegacyId),
          dueDate: opp.nextAction!.dueDate,
          priority: opp.priority,
          state: 'open' as const,
          createdBy: legacyUuid(opp.ownerLegacyId),
          createdAt: createdAtFor(opp.createdOn),
          updatedAt: createdAtFor(opp.createdOn),
        }));

      if (followUpRows.length > 0) {
        await tx.insert(followUps).values(followUpRows);
      }

      // --- Milestone 4: contacts, links and activities -----------------------
      const ownerOf = new Map(seedOpportunities.map((opp) => [opp.legacyId, opp.ownerLegacyId]));
      const firstLink = new Map<string, string>();
      for (const link of seedContactLinks) {
        if (!firstLink.has(link.contactLegacyId)) firstLink.set(link.contactLegacyId, link.opportunityLegacyId);
      }

      await tx.insert(contacts).values(
        seedContacts.map((contact) => {
          const creator = ownerOf.get(firstLink.get(contact.legacyId) ?? '') ?? 'u-arif';
          return {
            id: legacyUuid(contact.legacyId),
            organizationId: legacyUuid(contact.organizationLegacyId),
            fullName: contact.fullName,
            designation: contact.designation,
            department: contact.department || null,
            email: contact.email?.toLowerCase() ?? null,
            phone: contact.phone,
            createdBy: legacyUuid(creator),
          };
        }),
      );

      // The demo's per-contact note goes on the contact's first link only: see
      // seedDirectory.ts for why it must not be copied to every link.
      await tx.insert(opportunityContacts).values(
        seedContactLinks.map((link) => {
          const contact = seedContacts.find((row) => row.legacyId === link.contactLegacyId);
          if (!contact) throw new Error(`Link to unknown contact ${link.contactLegacyId}`);
          return {
            opportunityId: legacyUuid(link.opportunityLegacyId),
            contactId: legacyUuid(link.contactLegacyId),
            relationshipNotes:
              firstLink.get(link.contactLegacyId) === link.opportunityLegacyId ? contact.demoNote : null,
            createdBy: legacyUuid(ownerOf.get(link.opportunityLegacyId) ?? 'u-arif'),
          };
        }),
      );

      // FR-040: an activity's contact must be linked to the same opportunity.
      const linked = new Set(seedContactLinks.map((link) => `${link.opportunityLegacyId}|${link.contactLegacyId}`));
      for (const activity of seedActivities) {
        if (activity.contactLegacyId && !linked.has(`${activity.opportunityLegacyId}|${activity.contactLegacyId}`)) {
          throw new Error(`Activity ${activity.legacyId} names a contact not linked to its opportunity.`);
        }
      }
      await tx.insert(activities).values(
        seedActivities.map((activity) => ({
          id: legacyUuid(activity.legacyId),
          opportunityId: legacyUuid(activity.opportunityLegacyId),
          occurredAt: new Date(activity.occurredAt),
          type: activity.type,
          subject: activity.subject,
          notes: activity.notes,
          contactId: activity.contactLegacyId ? legacyUuid(activity.contactLegacyId) : null,
          authorId: legacyUuid(activity.authorLegacyId),
          createdAt: new Date(activity.occurredAt),
          updatedAt: new Date(activity.occurredAt),
        })),
      );

      // --- Milestone 5: tenders (documents are never seeded; see seedTenders.ts)
      const creatorOf = (opportunityLegacyId: string) => legacyUuid(ownerOf.get(opportunityLegacyId) ?? 'u-arif');
      await tx.insert(tenders).values(
        seedTenders.map((tender) => ({
          id: legacyUuid(tender.legacyId),
          opportunityId: legacyUuid(tender.opportunityLegacyId),
          procuringOrganizationId: legacyUuid(tender.procuringOrganizationLegacyId),
          title: tender.title,
          reference: tender.reference,
          procurementMethod: tender.procurementMethod,
          noticeUrl: tender.noticeUrl,
          publicationDate: tender.publicationDate,
          clarificationDeadline: tender.clarificationDeadline ? new Date(tender.clarificationDeadline) : null,
          submissionDeadline: new Date(tender.submissionDeadline),
          bidStatus: tender.bidStatus,
          submittedAt: tender.submittedAt ? new Date(tender.submittedAt) : null,
          isCurrent: true,
          noticeState: 'current' as const,
          notes: tender.notes,
          createdBy: creatorOf(tender.opportunityLegacyId),
          createdAt: new Date(`${tender.publicationDate}T11:00:00+06:00`),
          updatedAt: new Date(`${tender.publicationDate}T11:00:00+06:00`),
        })),
      );

      // Keep new records clear of the fixture reference block.
      await tx.execute(sql`SELECT setval('opportunity_reference_seq', 1000, false)`);

      return {
        databaseName,
        sections: seedSections.length,
        users: seedUsers.length,
        organizations: seedOrganizations.length,
        opportunities: seedOpportunities.length,
        followUps: followUpRows.length,
        contacts: seedContacts.length,
        contactLinks: seedContactLinks.length,
        activities: seedActivities.length,
        tenders: seedTenders.length,
      };
    });
  } finally {
    await pool.end();
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  const useTestDatabase = process.argv.includes('--test');
  const variable = useTestDatabase ? 'TEST_MIGRATION_DATABASE_URL' : 'MIGRATION_DATABASE_URL';
  const connectionString = process.env[variable]?.trim();

  if (!connectionString) {
    console.error(`${variable} is not set. See .env.example.`);
    process.exit(1);
  }

  seedDatabase(connectionString)
    .then((summary) => {
      console.log(
        `Seeded "${summary.databaseName}" with synthetic fixtures: ` +
          `${summary.sections} sections, ${summary.users} users, ` +
          `${summary.organizations} organizations, ${summary.opportunities} opportunities, ` +
          `${summary.followUps} open follow-ups, ${summary.contacts} contacts, ` +
          `${summary.contactLinks} contact links, ${summary.activities} activities, ${summary.tenders} tenders.`,
      );
      console.log('All records are fictional. No real Penta or government data is present.');
    })
    .catch((error: unknown) => {
      console.error('Seed failed:', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
