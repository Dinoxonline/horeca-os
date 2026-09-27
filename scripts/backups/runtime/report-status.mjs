import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sanitizeRunResult } from '../../../lib/backup-status.mjs';

try {
  const result = JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
  const receipt = sanitizeRunResult(result);
  const token = execFileSync(process.argv[3], ['-NoProfile', '-File', fileURLToPath(new URL('../Read-BackupReportCredential.ps1', import.meta.url))], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('CREDENTIAL_INVALID');
  const response = await fetch('https://xsduwtkrmfkphidkoght.supabase.co/functions/v1/horeca-backup-report', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-backup-report-token': token }, body: JSON.stringify(receipt), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok || (await response.json()).ok !== true) throw new Error('REPORT_FAILED');
  console.log(JSON.stringify({ reportDelivered: true, runId: receipt.run_id }));
} catch {
  console.log(JSON.stringify({ reportDelivered: false, error: 'BACKUP_STATUS_REPORT_FAILED' }));
  process.exitCode = 1;
}
