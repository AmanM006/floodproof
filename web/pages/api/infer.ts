import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';

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

    // Sanitize user-provided scene name
    const rawName = fields.name ? (Array.isArray(fields.name) ? fields.name[0] : fields.name) : 'User Uploaded SAR Scene';
    const cleanName = String(rawName).replace(/[^\w\s\(\)\-\.]/g, '').trim().substring(0, 100);

    const scriptPath = path.join(process.cwd(), '..', 'src', 'product', 'inference_engine.py');
    const outJsonPath = path.join(uploadDir, `inference_out_${Date.now()}.json`);

    // SECURE EXECUTION: execFile with argument array, shell DISABLED
    const pythonExe = 'python';
    const args = [
      scriptPath,
      fileField.filepath,
      cleanName || 'Uploaded SAR Scene',
      outJsonPath
    ];

    execFile(pythonExe, args, { maxBuffer: 10 * 1024 * 1024, timeout: 60000, shell: false }, (execErr, stdout, stderr) => {
      if (execErr) {
        return res.status(500).json({ 
          error: 'Inference pipeline execution error', 
          details: stderr || execErr.message 
        });
      }

      if (!fs.existsSync(outJsonPath)) {
        return res.status(500).json({
          error: 'Inference pipeline did not produce output file',
          stdout,
          stderr
        });
      }

      try {
        const fileContent = fs.readFileSync(outJsonPath, 'utf-8');
        const result = JSON.parse(fileContent);

        // Verify image fields contract
        if (!result.img_sar_b64 || !result.img_cand_water_b64) {
          return res.status(500).json({
            error: 'Inference pipeline produced incomplete image outputs',
            keys: Object.keys(result)
          });
        }

        // Clean up temp json
        fs.unlinkSync(outJsonPath);

        // Append to local scenes.json so the browser can immediately select it
        const scenesPath = path.join(process.cwd(), 'data', 'scenes.json');
        if (fs.existsSync(scenesPath)) {
          const currentScenes = JSON.parse(fs.readFileSync(scenesPath, 'utf-8'));
          currentScenes[result.metadata.id] = result;
          fs.writeFileSync(scenesPath, JSON.stringify(currentScenes, null, 2), 'utf-8');
        }

        return res.status(200).json(result);
      } catch (parseErr: any) {
        return res.status(500).json({ 
          error: 'Failed to read/parse inference engine JSON result', 
          details: parseErr.message 
        });
      }
    });
  });
}
