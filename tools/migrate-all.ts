/**
 * Helm — Multi-Tenant Schema Migration Runner
 *
 * Queries the master tenant registry, then runs `prisma migrate deploy`
 * against each tenant's schema sequentially. Stops on any failure and
 * logs per-tenant results.
 *
 * Usage: npx tsx tools/migrate-all.ts
 */

import { execSync } from 'child_process';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

interface TenantRecord {
  id: string;
  name: string;
  subdomain: string;
  status: string;
}

interface MigrationResult {
  tenantId: string;
  tenantName: string;
  schema: string;
  success: boolean;
  duration: number;
  error?: string;
}

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Exiting.');
  process.exit(1);
}

function buildSchemaUrl(baseUrl: string, schema: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set('schema', schema);
  return url.toString();
}

async function fetchTenants(): Promise<TenantRecord[]> {
  // Use the public schema to query the master tenant registry
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({
    datasources: {
      db: { url: buildSchemaUrl(DATABASE_URL!, 'public') },
    },
  });

  try {
    const tenants = await prisma.$queryRaw<TenantRecord[]>`
      SELECT id, name, subdomain, status
      FROM public.tenants
      WHERE status != 'LOCKED'
      ORDER BY name ASC
    `;
    return tenants;
  } finally {
    await prisma.$disconnect();
  }
}

function runMigration(schema: string): void {
  const schemaUrl = buildSchemaUrl(DATABASE_URL!, schema);
  const prismaDir = path.resolve(__dirname, '../apps/api/prisma');

  execSync(`npx prisma migrate deploy --schema="${prismaDir}/schema.prisma"`, {
    env: {
      ...process.env,
      DATABASE_URL: schemaUrl,
    },
    stdio: 'pipe',
    timeout: 120_000, // 2 minutes per tenant
  });
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Helm — Multi-Tenant Schema Migration Runner');
  console.log('='.repeat(60));
  console.log();

  // Step 1: Run migration on the public schema (master registry)
  console.log('[public] Running migration on master registry...');
  const publicStart = Date.now();
  try {
    runMigration('public');
    console.log(`[public] ✓ Completed in ${Date.now() - publicStart}ms`);
  } catch (err) {
    console.error(`[public] ✗ Migration failed on master registry. Aborting.`);
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // Step 2: Fetch all active tenants
  console.log();
  console.log('Fetching tenant registry...');
  let tenants: TenantRecord[];
  try {
    tenants = await fetchTenants();
  } catch (err) {
    console.error('Failed to fetch tenant registry. Aborting.');
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  if (tenants.length === 0) {
    console.log('No tenants found. Nothing to migrate.');
    return;
  }

  console.log(`Found ${tenants.length} tenant(s) to migrate.`);
  console.log();

  // Step 3: Run migration on each tenant schema sequentially
  const results: MigrationResult[] = [];

  for (const tenant of tenants) {
    const schema = `tenant_${tenant.id}`;
    const start = Date.now();

    console.log(`[${schema}] Migrating "${tenant.name}"...`);

    try {
      runMigration(schema);
      const duration = Date.now() - start;
      console.log(`[${schema}] ✓ Completed in ${duration}ms`);
      results.push({
        tenantId: tenant.id,
        tenantName: tenant.name,
        schema,
        success: true,
        duration,
      });
    } catch (err) {
      const duration = Date.now() - start;
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[${schema}] ✗ FAILED after ${duration}ms`);
      console.error(`  Error: ${errorMessage}`);
      results.push({
        tenantId: tenant.id,
        tenantName: tenant.name,
        schema,
        success: false,
        duration,
        error: errorMessage,
      });

      // Stop on first failure
      console.error();
      console.error('Migration stopped on failure. Fix the issue and re-run.');
      break;
    }
  }

  // Step 4: Summary
  console.log();
  console.log('='.repeat(60));
  console.log('Migration Summary');
  console.log('='.repeat(60));

  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`Total tenants: ${tenants.length}`);
  console.log(`Migrated:      ${succeeded.length}`);
  console.log(`Failed:        ${failed.length}`);
  console.log(`Skipped:       ${tenants.length - results.length}`);
  console.log();

  for (const result of results) {
    const status = result.success ? '✓' : '✗';
    console.log(
      `  ${status} ${result.tenantName.padEnd(30)} ${result.schema.padEnd(25)} ${result.duration}ms`
    );
  }

  if (failed.length > 0) {
    process.exit(1);
  }

  console.log();
  console.log('All migrations completed successfully.');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
