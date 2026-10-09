import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

export const config = {
  api: {
    bodyParser: false, // Disabling body parser for multipart form-data
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const uploadDir = path.join(process.cwd(), '..', 'data', 'uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const form = formidable({
    uploadDir,
    keepExtensions: true,
    maxFileSize: 50 * 1024 * 1024, // 50MB
  });

  form.parse(req, (err, fields, files) => {
    if (err) {
      return res.status(500).json({ error: 'File upload parse failure', details: err.message });
    }

    const fileField = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!fileField || !fileField.filepath) {
      return res.status(400).json({ error: 'No valid GeoTIFF file uploaded in request' });
    }

    const lat = fields.lat ? (Array.isArray(fields.lat) ? fields.lat[0] : fields.lat) : '26.63';
    const lon = fields.lon ? (Array.isArray(fields.lon) ? fields.lon[0] : fields.lon) : '92.91';
    const name = fields.name ? (Array.isArray(fields.name) ? fields.name[0] : fields.name) : 'User Uploaded SAR Scene';

    const scriptPath = path.join(process.cwd(), '..', 'src', 'product', 'inference_engine.py');
    const cmd = `python "${scriptPath}" "${fileField.filepath}" ${lat} ${lon} "${name}"`;

    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (execErr, stdout, stderr) => {
      if (execErr) {
        return res.status(500).json({ 
          error: 'Inference pipeline failure', 
          details: stderr || execErr.message 
        });
      }

      try {
        const result = JSON.parse(stdout);

        // Also append into local scenes.json so the browser can immediately select it
        const scenesPath = path.join(process.cwd(), 'data', 'scenes.json');
        if (fs.existsSync(scenesPath)) {
          const currentScenes = JSON.parse(fs.readFileSync(scenesPath, 'utf-8'));
          currentScenes[result.metadata.id] = result;
          fs.writeFileSync(scenesPath, JSON.stringify(currentScenes, null, 2), 'utf-8');
        }

        return res.status(200).json(result);
      } catch (parseErr: any) {
        return res.status(500).json({ 
          error: 'Failed to parse inference engine JSON output', 
          details: parseErr.message,
          raw_stdout: stdout.substring(0, 500)
        });
      }
    });
  });
}
