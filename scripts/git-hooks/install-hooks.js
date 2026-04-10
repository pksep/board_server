const fs = require('fs');
const path = require('path');

const hooksDir = path.join(__dirname);
const gitHooksDir = path.join(process.cwd(), '.git', 'hooks');

try {
  if (!fs.existsSync(gitHooksDir)) {
    throw new Error('.git/hooks directory not found');
  }

  const hookFiles = fs.readdirSync(hooksDir);

  hookFiles.forEach(file => {
    if (file === 'install-hooks.js') return;

    const src = path.join(hooksDir, file);
    const dest = path.join(gitHooksDir, file);

    if (!fs.statSync(src).isFile()) return;

    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, 0o755);

    console.log(`Installed git hook: ${file}`);
  });

  console.log('All Git hooks installed successfully.');
} catch (err) {
  console.error('Failed to install Git hooks:', err.message);
  process.exit(1);
}
