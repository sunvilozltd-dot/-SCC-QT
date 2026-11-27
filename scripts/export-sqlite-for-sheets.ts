/**
 * Non-Destructive SQLite → Google Sheets Migration Exporter
 *
 * Opens the existing local SQLite database strictly in READ-ONLY mode (never modifies or deletes it)
 * and outputs a verified JSON migration package compatible with Google Apps Script's
 * Settings → Backup & Restore → Upload Backup to Restore (gas/BackupRestore.gs).
 *
 * Usage:
 *   npm run export:sqlite
 *   tsx scripts/export-sqlite-for-sheets.ts [optional-sqlite-path] [optional-output-json-path]
 */

import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SECRET_SETTING_KEYS = new Set([
  'google_sync_secret',
  'secondary_drive_secret',
  'secondary_drive_sync_secret',
  'session_secret',
  'admin_password',
]);

function getTodayDhakaIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function safeReadTable(db: Database.Database, tableName: string): Record<string, unknown>[] {
  const exists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(tableName);
  if (!exists) return [];
  return db.prepare(`SELECT * FROM "${tableName}"`).all() as Record<string, unknown>[];
}

function main() {
  const defaultCandidates = [
    process.env.DB_PATH || '',
    path.resolve(process.cwd(), 'data', 'sunviloz.db'),
    path.resolve(process.cwd(), 'data', 'sunviloz.sqlite'),
  ].filter(Boolean);

  const argPath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : '';
  const dbPath = argPath || defaultCandidates.find((p) => fs.existsSync(p)) || '';

  if (!dbPath || !fs.existsSync(dbPath)) {
    console.error('[export:sqlite] No existing SQLite database file found. Checked:', defaultCandidates);
    process.exit(1);
  }

  // Strictly read-only: source SQLite file is never modified or deleted
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  try {
    const rawUsers = safeReadTable(db, 'users');
    const sanitizedUsers = rawUsers.map((u) => {
      const copy: Record<string, unknown> = { ...u };
      delete copy.password_hash;
      delete copy.password_salt;
      return copy;
    });

    const rawSettings = safeReadTable(db, 'settings');
    const sanitizedSettings = rawSettings.filter((row) => {
      const k = String(row.key || '').trim().toLowerCase();
      return k && !SECRET_SETTING_KEYS.has(k);
    });

    const tables: Record<string, Record<string, unknown>[]> = {
      users: sanitizedUsers,
      customers: safeReadTable(db, 'customers'),
      buildings: safeReadTable(db, 'buildings'),
      leads: safeReadTable(db, 'leads'),
      lead_notes: safeReadTable(db, 'lead_notes'),
      orders: safeReadTable(db, 'orders'),
      status_history: safeReadTable(db, 'status_history'),
      order_workers: safeReadTable(db, 'order_workers'),
      worker_payment_history: safeReadTable(db, 'worker_payment_history'),
      settlement_entries: safeReadTable(db, 'settlement_entries'),
      complaints: safeReadTable(db, 'complaints'),
      quotations: safeReadTable(db, 'quotations'),
      receipts: safeReadTable(db, 'receipts'),
      workers: safeReadTable(db, 'workers'),
      overhead_expenses: safeReadTable(db, 'overhead_expenses'),
      document_pads: safeReadTable(db, 'document_pads'),
      issued_pdfs: safeReadTable(db, 'issued_pdfs'),
      reminder_log: safeReadTable(db, 'reminder_log'),
      backup_history: safeReadTable(db, 'backup_history'),
      settings: sanitizedSettings,
    };

    const canonicalPayload = JSON.stringify(tables);
    const checksumSha256 = crypto.createHash('sha256').update(canonicalPayload).digest('hex');

    const migrationPackage = {
      format: 'sunviloz_sqlite_migration_v1',
      schema_version: 3,
      app: 'SUNVILOZ Clean Care',
      exported_at: new Date().toISOString(),
      exported_by: 'export-sqlite-for-sheets',
      source_db_file: path.basename(dbPath),
      checksum_sha256: checksumSha256,
      security_note:
        'Password hashes, session tokens, WebAuthn credentials, and sync secrets were excluded.',
      record_counts: Object.fromEntries(
        Object.entries(tables).map(([k, rows]) => [k, rows.length])
      ),
      tables,
    };

    const outArg = process.argv[3];
    const outPath = outArg
      ? path.resolve(process.cwd(), outArg)
      : path.resolve(
          process.cwd(),
          'data',
          `sunviloz-sqlite-export-${getTodayDhakaIso()}.json`
        );

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(migrationPackage, null, 2), 'utf8');

    console.log('');
    console.log('SUNVILOZ Clean Care — SQLite Migration Export Complete (Read-Only)');
    console.log('==================================================================');
    console.log(`Source SQLite (untouched): ${dbPath}`);
    console.log(`Export JSON:               ${outPath}`);
    console.log(`SHA-256 Checksum:          ${checksumSha256}`);
    console.log('');
    console.log('Record-Count Verification Table:');
    let totalBusinessRows = 0;
    for (const [name, rows] of Object.entries(tables)) {
      if (name !== 'settings' && name !== 'users') totalBusinessRows += rows.length;
      console.log(`  ${name.padEnd(24)} ${String(rows.length).padStart(6)}`);
    }
    console.log(`  ${'TOTAL BUSINESS ROWS'.padEnd(24)} ${String(totalBusinessRows).padStart(6)}`);
    console.log('');
    console.log('Next step: Open your deployed Google Apps Script web app as Admin →');
    console.log('Settings → Backup & Restore → Upload Backup to Restore, verify counts match,');
    console.log('and confirm RESTORE. Keep the source SQLite file until import is verified.');
  } finally {
    db.close();
  }
}

main();
