import sharp from 'sharp';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

for (const folder of ['public/assets/cards', 'public/assets/avatars']) {
  for (const file of await readdir(folder)) {
    if (!file.endsWith('.png')) continue;
    const input = join(folder, file), output = input.replace(/\.png$/, '.webp');
    await sharp(input).resize({ width: folder.endsWith('cards') ? 640 : 256, withoutEnlargement: true }).webp({ quality: 88 }).toFile(output);
    console.log(`${file}: ${(await stat(output)).size} bytes`);
    await unlink(input);
  }
}
