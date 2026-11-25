/**
 * Owner-only CLI helper to initialize or reset the local preview Admin password
 * in SQLite while preserving ADM-PRIMARY, username, orders, and all business data.
 *
 * NEVER exposed over HTTP. Run directly from the server shell:
 *   NEW_ADMIN_PASSWORD='<exact-password>' npx tsx scripts/admin-password-reset.ts
 */
import 'dotenv/config';
import { ownerResetOrInitAdminLocal } from '../server/db.ts';

const exactPass = process.env.NEW_ADMIN_PASSWORD || '';
if (!exactPass || exactPass.length < 6) {
  console.error('Error: Set NEW_ADMIN_PASSWORD (minimum 6 characters) in the environment before running.');
  process.exit(1);
}

const result = ownerResetOrInitAdminLocal(exactPass);
console.log(
  `Success: Admin account ${result.id} (${result.username}) updated. ` +
    `All previous sessions revoked; existing business data preserved.`
);
