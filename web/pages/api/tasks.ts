import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

const TASKS_PATH = path.join(process.cwd(), '..', 'reports', 'verification_tasks.json');
const S3_BUCKET = 'floodproof-verification-artifacts-699158992887';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      if (!fs.existsSync(TASKS_PATH)) {
        return res.status(200).json([]);
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
      
      // Strict validation: Require recorded evidence before marking field_verified
      if (task.status === 'field_verified') {
        if (!task.evidence || task.evidence.trim().length < 5) {
          return res.status(400).json({ 
            error: 'Validation Error: Ground photographic or sensor evidence details (min 5 chars) required before marking task "field_verified".' 
          });
        }
      }

      let tasks: any[] = [];
      if (fs.existsSync(TASKS_PATH)) {
        tasks = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf-8'));
      }

      // Check if existing task needs update or new entry
      const existingIdx = tasks.findIndex((t: any) => t.task_id === task.task_id);
      const timestamp = new Date().toISOString();

      if (existingIdx >= 0) {
        const prev = tasks[existingIdx];
        if (!prev.history) prev.history = [];
        prev.history.push({
          transition_time: timestamp,
          actor: task.actor || 'FloodProof Operator',
          previous_status: prev.status,
          new_status: task.status,
          evidence: task.evidence || '',
          notes: task.notes || ''
        });
        tasks[existingIdx] = { ...prev, ...task, history: prev.history };
      } else {
        task.created_at = timestamp;
        task.actor = task.actor || 'FloodProof Operator';
        task.history = [{
          transition_time: timestamp,
          actor: task.actor,
          previous_status: 'created',
          new_status: task.status,
          evidence: task.evidence || '',
          notes: task.notes || ''
        }];
        tasks.push(task);
      }

      fs.writeFileSync(TASKS_PATH, JSON.stringify(tasks, null, 2), 'utf-8');

      // Trigger S3 persistence
      exec(`aws s3 cp "${TASKS_PATH}" "s3://${S3_BUCKET}/tasks/verification_tasks.json"`, (err, stdout, stderr) => {
        if (err) console.error('S3 sync error:', err);
      });

      return res.status(200).json({ success: true, tasks });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
