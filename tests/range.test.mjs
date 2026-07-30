import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const functionFiles = [
  '../functions/lps/[lp]/media/[[path]].js',
  '../functions/assets/video/[[path]].js'
];

const sourceBytes = Uint8Array.from({ length: 256 }, (_, index) => index);

async function importFunction(relativePath) {
  const fileUrl = new URL(relativePath, import.meta.url);
  const source = await readFile(fileUrl, 'utf8');
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(moduleUrl);
}

function createEnvironment() {
  return {
    ASSETS: {
      async fetch() {
        return new Response(sourceBytes.slice(), {
          status: 200,
          headers: {
            'Content-Type': 'video/mp4',
            'Cache-Control': 'public, max-age=60'
          }
        });
      }
    }
  };
}

async function request(onRequest, range) {
  const headers = range ? { Range: range } : {};
  return onRequest({
    request: new Request('https://portfolio.test/video.mp4', { headers }),
    env: createEnvironment()
  });
}

for (const relativePath of functionFiles) {
  const { onRequest } = await importFunction(relativePath);
  const label = fileURLToPath(new URL(relativePath, import.meta.url));

  const complete = await request(onRequest);
  assert.equal(complete.status, 200, `${label}: asset completo deve retornar 200`);
  assert.deepEqual(
    new Uint8Array(await complete.arrayBuffer()),
    sourceBytes,
    `${label}: asset completo deve permanecer intacto`
  );

  const firstHundred = await request(onRequest, 'bytes=0-99');
  assert.equal(firstHundred.status, 206, `${label}: faixa deve retornar 206`);
  assert.equal(firstHundred.headers.get('Content-Length'), '100');
  assert.equal(firstHundred.headers.get('Content-Range'), 'bytes 0-99/256');
  assert.equal((await firstHundred.arrayBuffer()).byteLength, 100);

  const suffix = await request(onRequest, 'bytes=-50');
  assert.equal(suffix.status, 206, `${label}: sufixo deve retornar 206`);
  assert.equal(suffix.headers.get('Content-Length'), '50');
  assert.equal(suffix.headers.get('Content-Range'), 'bytes 206-255/256');
  assert.deepEqual(
    new Uint8Array(await suffix.arrayBuffer()),
    sourceBytes.slice(-50),
    `${label}: sufixo deve conter os ultimos 50 bytes`
  );

  const outside = await request(onRequest, 'bytes=999-1000');
  assert.equal(outside.status, 416, `${label}: faixa externa deve retornar 416`);
  assert.equal(outside.headers.get('Content-Range'), 'bytes */256');

  console.log(`ok - ${relativePath}`);
}

console.log('Range: 2 functions, 4 cenarios por function');
