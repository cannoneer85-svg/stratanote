/**
 * @module PlantUMLRouter
 * High-performance PlantUML SVG rendering engine with hybrid fallback.
 * Priority 1: Offline local Java execution (`java -jar plantuml.jar`)
 * Priority 2: Corporate self-hosted PlantUML/Kroki server (`PLANTUML_SERVER_URL`)
 * Priority 3: Official public PlantUML web service (`https://www.plantuml.com/plantuml`)
 */

import express from 'express';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import zlib from 'zlib';
import { execFile, execSync } from 'child_process';

const fetch = globalThis.fetch;

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = express.Router();

const cacheDir = join(__dirname, '..', 'cache', 'plantuml');
const vendorDir = join(__dirname, '..', 'vendor');
const jarPath = join(vendorDir, 'plantuml.jar');

if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

/**
 * Encodes 6-bit value into PlantUML custom Base64-like alphabet.
 * @param {number} b - 6-bit integer (0-63)
 * @returns {string} Encoded character
 */
function encode6bit(b) {
  if (b < 10) return String.fromCharCode(48 + b);
  b -= 10;
  if (b < 26) return String.fromCharCode(65 + b);
  b -= 26;
  if (b < 26) return String.fromCharCode(97 + b);
  b -= 26;
  if (b === 0) return '-';
  if (b === 1) return '_';
  return '?';
}

/**
 * Appends 3 bytes to 4 PlantUML encoded characters.
 * @param {number} b1 - First byte
 * @param {number} b2 - Second byte
 * @param {number} b3 - Third byte
 * @returns {string} 4-character string
 */
function append3bytes(b1, b2, b3) {
  const c1 = b1 >> 2;
  const c2 = ((b1 & 0x3) << 4) | (b2 >> 4);
  const c3 = ((b2 & 0xF) << 2) | (b3 >> 6);
  const c4 = b3 & 0x3F;
  return encode6bit(c1 & 0x3F) + encode6bit(c2 & 0x3F) + encode6bit(c3 & 0x3F) + encode6bit(c4 & 0x3F);
}

/**
 * Encodes PlantUML markup string into URL-safe PlantUML compressed format (`~1...`).
 * @param {string} text - PlantUML source code
 * @returns {string} PlantUML URL encoded payload
 */
export function encodePlantUML(text) {
  const compressed = zlib.deflateRawSync(Buffer.from(text, 'utf-8'), { level: 9 });
  let res = '';
  for (let i = 0; i < compressed.length; i += 3) {
    if (i + 2 < compressed.length) {
      res += append3bytes(compressed[i], compressed[i + 1], compressed[i + 2]);
    } else if (i + 1 < compressed.length) {
      res += append3bytes(compressed[i], compressed[i + 1], 0);
    } else {
      res += append3bytes(compressed[i], 0, 0);
    }
  }
  return '~1' + res;
}

/**
 * Checks if Java is installed and available in the system PATH.
 * @returns {boolean} True if java binary is accessible
 */
function isJavaAvailable() {
  try {
    execSync('java -version', { stdio: 'ignore' });
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Renders PlantUML code locally via Java subprocess.
 * @param {string} code - PlantUML diagram code
 * @returns {Promise<string>} Rendered SVG content
 */
function renderViaJava(code) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(jarPath)) {
      return reject(new Error('plantuml.jar not found'));
    }

    const child = execFile('java', ['-jar', jarPath, '-tsvg', '-pipe', '-charset', 'UTF-8'], {
      maxBuffer: 20 * 1024 * 1024,
      encoding: 'utf8'
    }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`Java process error: ${stderr || error.message}`));
      }
      if (!stdout || !stdout.trim().startsWith('<svg')) {
        return reject(new Error(`Invalid SVG output from Java: ${stderr || stdout}`));
      }
      resolve(stdout);
    });

    child.stdin.write(code, 'utf-8');
    child.stdin.end();
  });
}

/**
 * POST /api/plantuml/render
 * Renders PlantUML code into SVG using hybrid priority chain.
 */
router.post('/render', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Code parameter is required' });
    }

    // Ensure code has @startuml and @enduml wrappers if missing
    let cleanCode = code.trim();
    if (!cleanCode.includes('@start')) {
      cleanCode = `@startuml\n${cleanCode}\n@enduml`;
    }

    const hash = crypto.createHash('sha256').update(cleanCode).digest('hex');
    const cachedFilePath = join(cacheDir, `${hash}.svg`);

    // Check disk cache first (0 ms response)
    if (fs.existsSync(cachedFilePath)) {
      const cachedSvg = fs.readFileSync(cachedFilePath, 'utf8');
      return res.type('image/svg+xml').send(cachedSvg);
    }

    let svgOutput = '';

    // Priority 1: Local Java execution (100% Offline)
    if (isJavaAvailable() && fs.existsSync(jarPath)) {
      try {
        console.log('[PlantUML] Rendering locally via Java process...');
        svgOutput = await renderViaJava(cleanCode);
      } catch (err) {
        console.warn('[PlantUML] Java local rendering failed, falling back to network:', err.message);
      }
    }

    // Priority 2 & 3: Network rendering (Corporate URL or Public Fallback)
    if (!svgOutput) {
      const serverUrl = process.env.PLANTUML_SERVER_URL || 'https://www.plantuml.com/plantuml';
      const encoded = encodePlantUML(cleanCode);
      const targetUrl = `${serverUrl.replace(/\/$/, '')}/svg/${encoded}`;

      console.log(`[PlantUML] Requesting SVG from remote endpoint: ${serverUrl}`);
      const response = await fetch(targetUrl);
      if (!response.ok) {
        throw new Error(`Remote PlantUML server returned HTTP ${response.status}`);
      }

      svgOutput = await response.text();
      if (!svgOutput.trim().startsWith('<svg')) {
        throw new Error('Remote endpoint did not return valid SVG');
      }
    }

    // Cache the successfully generated SVG
    fs.writeFileSync(cachedFilePath, svgOutput, 'utf8');

    return res.type('image/svg+xml').send(svgOutput);
  } catch (err) {
    console.error('[PlantUML] Render error:', err);
    return res.status(500).json({ error: err.message || 'Failed to render PlantUML diagram' });
  }
});

export default router;
