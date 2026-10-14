import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { mkdtemp, mkdir, readdir, readFile, writeFile, unlink, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createHash } from 'node:crypto';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

await promisify(execFile)('cargo', ['build', '--manifest-path', 'src-tauri/Cargo.toml', '--examples']);
const extract = (documents) =>
  new Promise((resolve, reject) => {
    const child = execFile('src-tauri/target/debug/examples/graph-extract', { maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else {
        try {
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(error);
        }
      }
    });
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify(documents));
  });
const characterRoot = '/private/tmp/nagori-stage2-blog';
let characterTrash;
let characterBackup;
const createdPosts = new Set();
async function newPostCommand(input) {
  if (input.action === 'reset') {
    for (const path of createdPosts) await rm(join(characterRoot, path, '..'), { recursive: true });
    createdPosts.clear();
    return { restored: true };
  }
  return new Promise((resolve, reject) => {
    const child = execFile('src-tauri/target/debug/examples/blog-workspace', [characterRoot, '--new-post'], (error, stdout) => {
      if (error) reject(error);
      else {
        try {
          const result = JSON.parse(stdout);
          if (result.entry) createdPosts.add(result.entry.path);
          resolve(result);
        } catch (reason) { reject(reason); }
      }
    });
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify(input));
  });
}
let themeHistory;
let themeBackup;
async function themeCommand(input) {
  if (!themeHistory) throw Error('テーマの確認を開始してください。');
  return new Promise((resolve, reject) => {
    const child = execFile('src-tauri/target/debug/examples/blog-workspace', [characterRoot, '--themes', themeHistory], { maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else { try { resolve(JSON.parse(stdout)); } catch (reason) { reject(reason); } }
    });
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify(input));
  });
}
async function characterCommand(input) {
  if (!characterTrash) throw Error('キャラクターの確認を開始してください。');
  return new Promise((resolve, reject) => {
    const child = execFile('src-tauri/target/debug/examples/blog-workspace', [characterRoot, '--characters', characterTrash], { maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else { try { resolve(JSON.parse(stdout)); } catch (reason) { reject(reason); } }
    });
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify(input));
  });
}
async function backupCharacterFile(path) {
  if (!characterBackup || characterBackup.has(path)) return;
  if (path !== 'src/config.ts' && path !== 'src/content/blog/nagori-character-check.md' && (!path.startsWith('public/') || path.split('/').includes('..'))) throw Error('確認用のファイルではありません。');
  characterBackup.set(path, await readFile(join(characterRoot, path)).catch(error => { if (error.code === 'ENOENT') return null; throw error; }));
}
async function resetCharacters() {
  if (characterBackup) {
    for (const [path, bytes] of characterBackup) {
      if (bytes === null) await unlink(join(characterRoot, path)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      else { await mkdir(join(characterRoot, path, '..'), { recursive: true }); await writeFile(join(characterRoot, path), bytes); }
    }
  }
  if (characterTrash) await rm(characterTrash, { recursive: true, force: true });
  // 確認で作った空の画像フォルダだけを片付ける。
  await import('node:fs/promises').then(({ rmdir }) => rmdir(join(characterRoot, 'public/images/nagori_check')).catch(() => {}));
  characterBackup = undefined; characterTrash = undefined;
}
const fixtureRoot = await mkdtemp('/private/tmp/nagori-editor-graph-');
const fixtureDocuments = [
  { path: 'notes/first.md', text: '---\ntitle: 最初のノート\ntags: [共通, 考え]\n---\n# 最初\n[次](second.md) [[散歩]]\n' },
  { path: 'notes/second.md', text: '---\ntitle: 次のノート\ntags: 共通\n---\n# 次\n[最初](first.md#section)\n' },
  { path: '日記/散歩.md', text: '# 散歩\n[[first]]\n' },
  { path: 'README.md', text: '# ワークスペース\n[最初](notes/first.md)\n' },
];
for (const doc of fixtureDocuments) {
  await mkdir(join(fixtureRoot, doc.path, '..'), { recursive: true });
  await writeFile(join(fixtureRoot, doc.path), doc.text);
}
const memoryCount = 300;
function memoryDocument(i) {
  const next = (i + 1) % memoryCount;
  const header = `---\ntitle: 記事${i}\ntags: [タグ${i % 12}, 共通]\n---\n[次の記事](article-${next}.md)\n`;
  const block = '画像の参照を含む長い本文です。'.repeat(100) + `\n![画像](./images/picture-${i}.jpg)\n\n`;
  return { path: `notes/article-${i}.md`, text: header + block.repeat(80) };
}
const server = await createServer({
  configFile: false,
  plugins: [
    svelte(),
    {
      name: 'ime-check',
      configureServer(server) {
        server.middlewares.use('/tests/wkwebview/blog-new-post', async (request, response) => {
          response.setHeader('Content-Type', 'application/json');
          try {
            let body = '';
            for await (const chunk of request) {
              body += chunk;
              if (body.length > 4 * 1024 * 1024) throw Error('確認の入力が大きすぎます。');
            }
            response.end(JSON.stringify(await newPostCommand(JSON.parse(body))));
          } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: String(error) })); }
        });
        server.middlewares.use('/tests/wkwebview/blog-themes', async (request, response) => {
          response.setHeader('Content-Type', 'application/json');
          try {
            let body = '';
            for await (const chunk of request) { body += chunk; if (body.length > 64 * 1024) throw Error('確認の入力が大きすぎます。'); }
            const input = JSON.parse(body);
            if (input.action === 'prepare') {
              if (themeHistory) throw Error('テーマの確認が実行中です。');
              themeBackup = await readFile(join(characterRoot, 'src/theme/theme.css'));
              themeHistory = await mkdtemp('/private/tmp/nagori-theme-history-');
              response.end(JSON.stringify({ ready: true }));
            } else if (input.action === 'reset') {
              if (themeBackup) await writeFile(join(characterRoot, 'src/theme/theme.css'), themeBackup);
              if (themeHistory) await rm(themeHistory, { recursive: true, force: true });
              themeBackup = undefined; themeHistory = undefined;
              response.end(JSON.stringify({ restored: true }));
            } else response.end(JSON.stringify(await themeCommand(input)));
          } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: String(error) })); }
        });
        server.middlewares.use('/tests/wkwebview/blog-characters', async (request, response) => {
          response.setHeader('Content-Type', 'application/json');
          try {
            let body = '';
            for await (const chunk of request) { body += chunk; if (body.length > 32 * 1024 * 1024) throw Error('確認の入力が大きすぎます。'); }
            const input = JSON.parse(body);
            if (input.action === 'prepare') {
              if (characterBackup) throw Error('キャラクターの確認が実行中です。');
              characterBackup = new Map(); characterTrash = await mkdtemp('/private/tmp/nagori-character-trash-');
              await backupCharacterFile('src/config.ts');
              await backupCharacterFile('src/content/blog/nagori-character-check.md');
              await writeFile(join(characterRoot, 'src/content/blog/nagori-character-check.md'), '> [!NAGORI_CHECK]\n> 管理の確認\n\n> [!NAGORI_CHECK grin]\n> 表情の確認\n');
              response.end(JSON.stringify({ ready: true }));
            } else if (input.action === 'reset') {
              await resetCharacters(); response.end(JSON.stringify({ restored: true }));
            } else {
              if (input.action === 'save') {
                for (const image of input.request.images) await backupCharacterFile(image.path);
                for (const path of input.request.removedImages) await backupCharacterFile(path);
              }
              response.end(JSON.stringify(await characterCommand(input)));
            }
          } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: String(error) })); }
        });
        server.middlewares.use('/tests/wkwebview/blog-image', async (request, response) => {
          try {
            const path = new URL(request.url, 'http://localhost').searchParams.get('path');
            const { stdout } = await promisify(execFile)(
              'src-tauri/target/debug/examples/blog-workspace',
              ['/private/tmp/nagori-stage2-blog', '--image', path],
              { encoding: 'buffer' },
            );
            response.end(stdout);
          } catch (error) {
            response.statusCode = 500;
            response.end(String(error));
          }
        });
        server.middlewares.use('/tests/wkwebview/blog-card-check', async (_request, response) => {
          const root = '/private/tmp/nagori-stage2-blog',
            cachePath = join(root, 'src/data/link-cards.json');
          let original, imagePath, local;
          try {
            original = await readFile(cachePath).catch(() => null);
            const image = await readFile(join(root, 'public/images/nagori/normal.png'));
            local = createHttpServer((request, reply) => {
              reply.setHeader('Content-Type', request.url === '/image.png' ? 'image/png' : 'text/html');
              reply.end(
                request.url === '/image.png'
                  ? image
                  : '<title>ローカルのカード</title><meta name="description" content="保存の見本"><meta property="og:image" content="/image.png">',
              );
            });
            await new Promise((resolve) => local.listen(0, '127.0.0.1', resolve));
            const url = `http://127.0.0.1:${local.address().port}/preview`;
            const hash = createHash('sha256').update(url).digest('hex').slice(0, 16);
            imagePath = join(root, 'public/link-cards', hash + '.webp');
            const { stdout } = await promisify(execFile)('src-tauri/target/debug/examples/blog-workspace', [root, '--fetch-card', url]);
            const preview = JSON.parse(stdout),
              cache = JSON.parse(await readFile(cachePath, 'utf8'));
            const output = await readFile(imagePath);
            response.setHeader('Content-Type', 'application/json');
            response.end(
              JSON.stringify({
                saved: cache[url]?.title === 'ローカルのカード' && !!cache[url]?.fetchedAt,
                sorted: JSON.stringify(Object.keys(cache)) === JSON.stringify(Object.keys(cache).sort()),
                webp: output.subarray(0, 4).toString() === 'RIFF' && output.subarray(8, 12).toString() === 'WEBP',
                image: preview.image === '/link-cards/' + hash + '.webp',
              }),
            );
          } catch (error) {
            response.statusCode = 500;
            response.end(JSON.stringify({ error: String(error) }));
          } finally {
            if (local) await new Promise((resolve) => local.close(resolve));
            if (original !== undefined) {
              if (original) await writeFile(cachePath, original);
              else await unlink(cachePath).catch(() => {});
            }
            if (imagePath) await unlink(imagePath).catch(() => {});
          }
        });
        server.middlewares.use('/tests/wkwebview/blog-theme', async (request, response) => {
          response.setHeader('Content-Type', 'application/json');
          try {
            if (request.method === 'POST') {
              let input = '';
              for await (const chunk of request) input += chunk;
              const { path, text } = JSON.parse(input);
              if (!['src/theme/theme.css', 'src/styles/template.css'].includes(path) || typeof text !== 'string')
                throw Error('Invalid theme file');
              await writeFile(join('/private/tmp/nagori-stage2-blog', path), text);
            }
            const { stdout } = await promisify(execFile)('src-tauri/target/debug/examples/blog-workspace', [
              '/private/tmp/nagori-stage2-blog',
              '--theme',
            ]);
            response.end(stdout);
          } catch (error) {
            response.statusCode = 500;
            response.end(JSON.stringify({ error: String(error) }));
          }
        });
        server.middlewares.use('/tests/wkwebview/blog-data', async (_request, response) => {
          response.setHeader('Content-Type', 'application/json');
          try {
            const { stdout } = await promisify(execFile)(
              'src-tauri/target/debug/examples/blog-workspace',
              ['/private/tmp/nagori-stage2-blog'],
              { maxBuffer: 8 * 1024 * 1024 },
            );
            response.end(stdout);
          } catch (error) {
            response.statusCode = 500;
            response.end(JSON.stringify({ error: String(error) }));
          }
        });
        server.middlewares.use('/tests/wkwebview/graph-extract', async (request, response) => {
          response.setHeader('Content-Type', 'application/json');
          try {
            let input = '';
            for await (const chunk of request) input += chunk;
            response.end(JSON.stringify(await extract(JSON.parse(input))));
          } catch (error) {
            response.statusCode = 500;
            response.end(JSON.stringify({ error: String(error) }));
          }
        });
        server.middlewares.use('/tests/wkwebview/graph-memory-data', async (_request, response) => {
          response.setHeader('Content-Type', 'application/json');
          try {
            const documents = Array.from({ length: memoryCount }, (_, i) => memoryDocument(i));
            const sourceBytes = documents.reduce((sum, doc) => sum + Buffer.byteLength(doc.text), 0);
            response.end(JSON.stringify({ articles: await extract(documents), sourceBytes }));
          } catch (error) {
            response.statusCode = 500;
            response.end(JSON.stringify({ error: String(error) }));
          }
        });
        server.middlewares.use('/tests/wkwebview/graph-memory-document', (_request, response) => {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(memoryDocument(0)));
        });
        server.middlewares.use('/tests/wkwebview/graph-data', async (_request, response) => {
          const root = fixtureRoot;
          const documents = [];
          async function walk(path = '') {
            for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
              if (entry.name === '.git' || entry.name === 'node_modules' || entry.name.startsWith('.nagori-save-')) continue;
              const child = path ? path + '/' + entry.name : entry.name;
              if (entry.isDirectory()) await walk(child);
              else if (entry.isFile() && /\.md$/i.test(entry.name))
                documents.push({ path: child, text: await readFile(join(root, child), 'utf8') });
            }
          }
          response.setHeader('Content-Type', 'application/json');
          try {
            await walk();
            response.end(JSON.stringify({ root, documents }));
          } catch (error) {
            response.statusCode = 500;
            response.end(JSON.stringify({ error: String(error) }));
          }
        });
        server.middlewares.use('/tests/wkwebview/ime-check', (_request, response) => {
          response.setHeader('Content-Type', 'text/html');
          response.end(
            '<!doctype html><html><head><meta charset="utf-8"><style>html,body,#host{height:100%;margin:0}#host{height:650px}</style></head><body><div id="host"></div><script type="module" src="/tests/wkwebview/fixture.js"></script></body></html>',
          );
        });
      },
    },
  ],
  server: { host: '127.0.0.1', port: Number(process.env.WKWEBVIEW_PORT ?? 1438), strictPort: true },
});
await server.listen();
console.log(`WKWebView確認ページ http://127.0.0.1:${server.config.server.port}/tests/wkwebview/ime-check`);
