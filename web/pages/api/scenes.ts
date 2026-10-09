import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const filePath = path.join(process.cwd(), 'data', 'scenes.json');
    const fileData = fs.readFileSync(filePath, 'utf-8');
    const scenes = JSON.parse(fileData);
    res.status(200).json(scenes);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to load scenes data', details: error.message });
  }
}
