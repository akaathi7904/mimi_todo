/**
 * Android Asset Preparer & Sync Script for Little Bloom Pro
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WWW_DIR = path.join(__dirname, 'www');

// Create www folder
if (!fs.existsSync(WWW_DIR)) {
  fs.mkdirSync(WWW_DIR, { recursive: true });
}

// Copy directory recursively
function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (let entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Files & Folders to copy into Android Web View bundle
const itemsToCopy = ['index.html', 'manifest.json', 'sw.js', 'css', 'js', 'icons'];

itemsToCopy.forEach(item => {
  const src = path.join(__dirname, item);
  const dest = path.join(WWW_DIR, item);
  if (fs.existsSync(src)) {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      copyDirSync(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
});

console.log('✅ Web assets bundled to www/ folder successfully!');
