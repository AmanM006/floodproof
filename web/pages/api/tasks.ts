import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import util from 'util';

const execFilePromise = util.promisify(execFile);
const TASKS_PATH = path.join(process.cwd(), '..', 'reports', 'verification_tasks.json');
const SYNC_STATE_PATH = path.join(process.cwd(), '..', 'reports', 'sync_state.json');
const S3_BUCKET = 'floodproof-verification-artifacts-699158992887';

// Strict state transition graph
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  'created': ['assigned', 'operator_reviewed'],
  'assigned': ['in_progress', 'rejected', 'inconclusive'],
  'in_progress': ['operator_reviewed', 'field_verified', 'rejected', 'inconclusive'],
  'operator_reviewed': ['field_verified', 'assigned', 'rejected', 'inconclusive'],
  'field_verified': ['operator_reviewed'], // Can revert if evidence disproved
  'rejected': ['assigned'],
  'inconclusive': ['assigned']
};

function getPersistedSyncState(): boolean {
  if (fs.existsSync(SYNC_STATE_PATH)) {
    try {
      const state = JSON.parse(fs.readFileSync(SYNC_STATE_PATH, 'utf-8'));
      return state.cloud_synced === true;
    } catch {
      return false;
    }
  }
  return false;
}

function setPersistedSyncState(synced: boolean) {
  try {
    fs.writeFileSync(SYNC_STATE_PATH, JSON.stringify({ cloud_synced: synced, updated_at: new Date().toISOString() }), 'utf-8');
  } catch (err) {
    console.warn('Failed to write sync_state.json:', err);
  }
}

async function loadTasksWithS3Fallback(): Promise<{ tasks: any[]; cloud_synced: boolean }> {
  // If local tasks file exists, check persisted sync state instead of blindly assuming true
  if (fs.existsSync(TASKS_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf-8'));
      const isSynced = getPersistedSyncState();
      return { tasks: Array.isArray(data) ? data : [], cloud_synced: isSynced };
    } catch (e) {
      console.warn('Local tasks file corrupt, attempting S3 pull recovery...');
    }
  }

  // Attempt recovery from AWS S3
  try {
    const awsArgs = ['s3', 'cp', `s3://${S3_BUCKET}/tasks/verification_tasks.json`, TASKS_PATH];
    await execFilePromise('aws', awsArgs, { shell: false });
    if (fs.existsSync(TASKS_PATH)) {
      const recovered = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf-8'));
      setPersistedSyncState(true);
      return { tasks: Array.isArray(recovered) ? recovered : [], cloud_synced: true };
    }
  } catch (err) {
    console.warn('S3 pull recovery unavailable:', err);
  }

  setPersistedSyncState(false);
  return { tasks: [], cloud_synced: false };
}

async function syncToS3WithRetry(retries = 2, delayMs = 300): Promise<{ success: boolean; error: string | null }> {
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const awsArgs = ['s3', 'cp', TASKS_PATH, `s3://${S3_BUCKET}/tasks/verification_tasks.json`];
      await execFilePromise('aws', awsArgs, { shell: false });
      setPersistedSyncState(true);
      return { success: true, error: null };
    } catch (err: any) {
      if (attempt <= retries) {
        await new Promise((r) => setTimeout(r, delayMs * attempt));
      } else {
        setPersistedSyncState(false);
        return { success: false, error: err.message || 'AWS S3 sync failed after retries' };
      }
    }
  }
  setPersistedSyncState(false);
  return { success: false, error: 'S3 sync exhausted' };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const { tasks, cloud_synced } = await loadTasksWithS3Fallback();
      return res.status(200).json({
        tasks,
        cloud_synced,
        total: tasks.length
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const task = req.body;
      const chipId = String(task.chip_id || '').trim();
      const sectorId = String(task.sector_id || '').trim();
      const newStatus = String(task.status || '').trim();
      const expectedVersion = task.expected_version !== undefined ? Number(task.expected_version) : null;

      if (!chipId || !sectorId || !newStatus) {
        return res.status(400).json({ error: 'Missing mandatory fields: chip_id, sector_id, status.' });
      }

      // Canonical task ID: TASK_<chip_id>_<sector_id>
      const canonicalId = `TASK_${chipId}_${sectorId}`;

      const { tasks } = await loadTasksWithS3Fallback();

      const existingIdx = tasks.findIndex((t: any) => t.task_id === canonicalId || (t.chip_id === chipId && t.sector_id === sectorId));
      const currentTask = existingIdx >= 0 ? tasks[existingIdx] : null;
      const currentStatus = currentTask ? currentTask.status : 'created';
      const currentVersion = currentTask ? (currentTask.version || 1) : 0;

      // 1. Optimistic Concurrency Protection: Reject stale updates
      if (expectedVersion !== null && currentTask && expectedVersion !== currentVersion) {
        return res.status(409).json({
          error: `Conflict: Task "${canonicalId}" was modified by another operator (expected version ${expectedVersion}, current version ${currentVersion}). Please reload and retry.`,
          current_version: currentVersion,
          task: currentTask
        });
      }

      // 2. Validate State Transition
      const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
      if (currentStatus !== newStatus && !allowed.includes(newStatus)) {
        return res.status(400).json({
          error: `Illegal state transition from "${currentStatus}" to "${newStatus}". Allowed transitions: ${allowed.join(', ')}.`
        });
      }

      // 3. Validate Evidence Requirement
      if (newStatus === 'field_verified') {
        const evidenceStr = String(task.evidence || '').trim();
        if (evidenceStr.length < 10) {
          return res.status(400).json({
            error: 'Traceable ground evidence (min 10 characters, e.g. surveyor reference, GPS log, high-water mark photo) is strictly required before marking task "field_verified".'
          });
        }
      }

      const timestamp = new Date().toISOString();
      const actor = String(task.actor || 'Satellite Analyst').trim();

      let updatedTask: any;

      if (existingIdx >= 0) {
        const prev = tasks[existingIdx];
        if (!prev.history) prev.history = [];
        prev.history.push({
          transition_time: timestamp,
          actor,
          previous_status: currentStatus,
          new_status: newStatus,
          evidence: task.evidence || prev.evidence || '',
          notes: task.notes || ''
        });
        updatedTask = {
          ...prev,
          task_id: canonicalId,
          version: (prev.version || 1) + 1,
          status: newStatus,
          assigned_team: task.assigned_team || prev.assigned_team || 'Unassigned',
          evidence: task.evidence || prev.evidence || '',
          notes: task.notes || prev.notes || '',
          updated_at: timestamp,
          history: prev.history
        };
        tasks[existingIdx] = updatedTask;
      } else {
        updatedTask = {
          task_id: canonicalId,
          chip_id: chipId,
          sector_id: sectorId,
          version: 1,
          actor,
          assigned_team: task.assigned_team || 'Unassigned',
          status: newStatus,
          evidence: task.evidence || '',
          notes: task.notes || '',
          simulated_demonstration: task.simulated_demonstration !== undefined ? Boolean(task.simulated_demonstration) : true,
          created_at: timestamp,
          updated_at: timestamp,
          history: [{
            transition_time: timestamp,
            actor,
            previous_status: 'created',
            new_status: newStatus,
            evidence: task.evidence || '',
            notes: task.notes || ''
          }]
        };
        tasks.push(updatedTask);
      }

      // Truly Atomic File Write via Temp File + Replace
      const tempPath = `${TASKS_PATH}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(tasks, null, 2), 'utf-8');
      fs.renameSync(tempPath, TASKS_PATH);

      // 4. AWAIT Real S3 Cloud Persistence with Retry
      const { success: s3Success, error: s3Error } = await syncToS3WithRetry(2, 200);

      return res.status(200).json({
        success: true,
        cloud_persisted: s3Success,
        cloud_synced: s3Success,
        cloud_error: s3Error,
        task: updatedTask,
        all_tasks: tasks
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
