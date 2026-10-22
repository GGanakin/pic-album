import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'dist');
await mkdir(output, { recursive: true });
for (const item of ['index.html', 'styles.css', 'app.js', 'photos.js', 'assets', 'all_pic']) {
  await cp(path.join(root, item), path.join(output, item), { recursive: true, force: true });
}
console.log('静态相册已生成到 dist/，包含 60 张照片的预览图和原图。');
