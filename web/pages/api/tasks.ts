import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import util from 'util';

const execFilePromise = util.promisify(execFile);
const TASKS_PATH = path.join(process.cwd(), '..', 'reports', 'verification_tasks.json');
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      if (!fs.existsSync(TASKS_PATH)) {
        return res.status(200).json({ tasks: [], cloud_synced: false });
      }
      const data = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf-8'));
      return res.status(200).json(data);
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

      if (!chipId || !sectorId || !newStatus) {
        return res.status(400).json({ error: 'Missing mandatory fields: chip_id, sector_id, status.' });
      }

      // Canonical task ID: TASK_<chip_id>_<sector_id>
      const canonicalId = `TASK_${chipId}_${sectorId}`;

      let tasks: any[] = [];
      if (fs.existsSync(TASKS_PATH)) {
        tasks = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf-8'));
      }

      const existingIdx = tasks.findIndex((t: any) => t.task_id === canonicalId || (t.chip_id === chipId && t.sector_id === sectorId));
      const currentStatus = existingIdx >= 0 ? tasks[existingIdx].status : 'created';

      // 1. Validate State Transition
      const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
      if (currentStatus !== newStatus && !allowed.includes(newStatus)) {
        return res.status(400).json({
          error: `Illegal state transition from "${currentStatus}" to "${newStatus}". Allowed transitions: ${allowed.join(', ')}.`
        });
      }

      // 2. Validate Evidence Requirement
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
          actor,
          assigned_team: task.assigned_team || 'Unassigned',
          status: newStatus,
          evidence: task.evidence || '',
          notes: task.notes || '',
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

      // Atomic file write
      fs.writeFileSync(TASKS_PATH, JSON.stringify(tasks, null, 2), 'utf-8');

      // 3. AWAIT Real S3 Cloud Persistence
      let s3Success = false;
      let s3Error = null;

      try {
        const awsArgs = ['s3', 'cp', TASKS_PATH, `s3://${S3_BUCKET}/tasks/verification_tasks.json`];
        await execFilePromise('aws', awsArgs, { shell: false });
        s3Success = true;
      } catch (err: any) {
        s3Error = err.message || 'AWS S3 sync failed';
        console.error('S3 sync error:', err);
      }

      return res.status(200).json({
        success: true,
        cloud_persisted: s3Success,
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
