"""
AWS Cloud Task Sync and Inference Engine for FloodProof.

Handles:
1. S3 bucket connection and artifact synchronization.
2. Cloud event logging and verification task persistence.
3. Verification task transitions:
   'unassigned' -> 'assigned' -> 'in_progress' -> 'operator_reviewed' -> 'field_verified' / 'rejected' / 'inconclusive'
4. Verifies S3 write and read operations directly with AWS.
"""

import os
import json
import subprocess
import pandas as pd
import numpy as np

S3_BUCKET = "floodproof-verification-artifacts-699158992887"
LOCAL_REPORTS_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'reports')
TASKS_LOG = os.path.join(LOCAL_REPORTS_DIR, 'verification_tasks.json')

VALID_TASK_STATUSES = [
    'unassigned', 'assigned', 'in_progress', 
    'operator_reviewed', 'field_verified', 
    'rejected', 'inconclusive'
]

class CloudTaskManager:
    def __init__(self, bucket_name: str = S3_BUCKET):
        self.bucket = bucket_name
        os.makedirs(LOCAL_REPORTS_DIR, exist_ok=True)
        if not os.path.exists(TASKS_LOG):
            with open(TASKS_LOG, 'w') as f:
                json.dump([], f)

    def load_tasks(self):
        with open(TASKS_LOG, 'r') as f:
            return json.load(f)

    def save_task(self, task_dict: dict):
        assert task_dict.get('status') in VALID_TASK_STATUSES, f"Invalid status: {task_dict.get('status')}"
        tasks = self.load_tasks()
        
        # Update existing or append new
        updated = False
        for i, t in enumerate(tasks):
            if t['task_id'] == task_dict['task_id']:
                # Preserve audit history
                if 'history' not in t:
                    t['history'] = []
                t['history'].append({
                    'transition_time': pd.Timestamp.now('UTC').isoformat(),
                    'previous_status': t['status'],
                    'new_status': task_dict['status'],
                    'notes': task_dict.get('notes', '')
                })
                task_dict['history'] = t['history']
                tasks[i] = task_dict
                updated = True
                break

        if not updated:
            task_dict['created_at'] = pd.Timestamp.now('UTC').isoformat()
            task_dict['history'] = [{
                'transition_time': task_dict['created_at'],
                'previous_status': 'created',
                'new_status': task_dict['status'],
                'notes': task_dict.get('notes', '')
            }]
            tasks.append(task_dict)

        with open(TASKS_LOG, 'w') as f:
            json.dump(tasks, f, indent=2)

        # Sync to S3
        cmd = f"aws s3 cp {TASKS_LOG} s3://{self.bucket}/tasks/verification_tasks.json"
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        s3_success = (res.returncode == 0)
        return s3_success

    def verify_s3_roundtrip(self):
        """Tests actual cloud write and read back from Amazon S3."""
        test_payload = {
            'ping': 'FloodProof S3 Cloud Verification',
            'timestamp': pd.Timestamp.now('UTC').isoformat(),
            'status': 'verified_roundtrip'
        }
        test_local = os.path.join(LOCAL_REPORTS_DIR, 's3_test_payload.json')
        with open(test_local, 'w') as f:
            json.dump(test_payload, f, indent=2)

        # Write to S3
        cmd_put = f"aws s3 cp {test_local} s3://{self.bucket}/diagnostics/s3_test_payload.json"
        res_put = subprocess.run(cmd_put, shell=True, capture_output=True, text=True)
        
        # Read back from S3
        test_readback = os.path.join(LOCAL_REPORTS_DIR, 's3_readback_payload.json')
        cmd_get = f"aws s3 cp s3://{self.bucket}/diagnostics/s3_test_payload.json {test_readback}"
        res_get = subprocess.run(cmd_get, shell=True, capture_output=True, text=True)

        if res_put.returncode == 0 and res_get.returncode == 0 and os.path.exists(test_readback):
            with open(test_readback, 'r') as f:
                rb_data = json.load(f)
            return True, rb_data
        else:
            return False, {'error_put': res_put.stderr, 'error_get': res_get.stderr}

if __name__ == '__main__':
    mgr = CloudTaskManager()
    ok, data = mgr.verify_s3_roundtrip()
    print("S3 Live Roundtrip Verification:", ok, data)
    
    # Create sample task
    sample_t = {
        'task_id': 'TASK_IND_SEC_49',
        'chip_id': 'India_591317',
        'sector_id': 'SEC_49',
        'assigned_team': 'Brahmaputra Quick Response Team 2',
        'status': 'assigned',
        'notes': 'Significant candidate water with high model disagreement. Dispatched for levee inspection.'
    }
    s3_ok = mgr.save_task(sample_t)
    print("Sample task saved & synced to S3:", s3_ok)
