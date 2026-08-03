const fs = require('fs');
const path = require('path');
const https = require('https');

const vendorDir = path.join(__dirname, '../server/vendor');
const jarPath = path.join(vendorDir, 'plantuml.jar');

if (!fs.existsSync(vendorDir)) {
  fs.mkdirSync(vendorDir, { recursive: true });
}

// Download URL for plantuml.jar
const jarUrl = 'https://github.com/plantuml/plantuml/releases/download/v1.2024.7/plantuml-1.2024.7.jar';

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading PlantUML JAR from ${url} ...`);
    const follow = (currentUrl) => {
      https.get(currentUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          console.log(`Following redirect to ${res.headers.location}`);
          return follow(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Failed to download: HTTP ${res.statusCode}`));
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log(`Successfully downloaded plantuml.jar to ${destPath}`);
          resolve(destPath);
        });
        file.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      }).on('error', (err) => {
        reject(err);
      });
    };
    follow(url);
  });
}

async function main() {
  if (fs.existsSync(jarPath) && fs.statSync(jarPath).size > 1000000) {
    console.log(`plantuml.jar already exists at ${jarPath} (${(fs.statSync(jarPath).size / 1024 / 1024).toFixed(2)} MB)`);
    return;
  }
  try {
    await downloadFile(jarUrl, jarPath);
  } catch (err) {
    console.error('Failed to download plantuml.jar:', err.message);
  }
}

main();
