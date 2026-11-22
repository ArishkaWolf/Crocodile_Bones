import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
// Transparent extraction of the author's original sheet, then lossless layout cuts.
const source = process.argv[2] || 'artifacts/stickers-transparent.png';
const rows = [0, 279, 524, 749, 995, 1254];
const columns = [[0,270,510,748,997,1254],[0,250,503,743,987,1254],[0,253,495,743,987,1254],[0,248,498,743,989,1254],[0,251,499,745,991,1254]];
await mkdir('public/assets/stickers', { recursive: true });
for (let row = 0; row < 5; row++) for (let col = 0; col < 5; col++) {
  const left = columns[row][col], top = rows[row];
  await sharp(source).extract({ left, top, width: columns[row][col+1] - left, height: rows[row+1] - top })
    .resize(256,256,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).webp({ quality: 95, alphaQuality: 100 }).toFile(`public/assets/stickers/${row*5+col+1}.webp`);
}
await sharp('../cards/list.png').resize({width:640}).webp({quality:92}).toFile('public/assets/cards/list.webp');
