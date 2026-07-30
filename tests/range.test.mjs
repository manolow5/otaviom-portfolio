// Testa a lógica de Range compartilhada (functions/_lib/range.js) e confere
// que as duas rotas são apenas invólucros dela — a lógica duplicada nas rotas
// já divergiu uma vez, e é isto que impede a reincidência.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { serveWithRange } = await import(new URL('../functions/_lib/range.js', import.meta.url));

const sourceBytes = Uint8Array.from({ length: 256 }, (_, index) => index);

// Monta um env.ASSETS cujo asset tem os headers pedidos, e registra qual
// Request chegou nele — os cenários de repasse dependem disso.
function createEnvironment(options = {}) {
  const bytes = options.bytes ?? sourceBytes;
  const seen = { request: null };
  const env = {
    ASSETS: {
      async fetch(incoming) {
        seen.request = incoming;
        const headers = {
          'Content-Type': 'video/mp4',
          'Cache-Control': 'public, max-age=60',
          ...(options.headers ?? {})
        };
        if (!options.omitContentLength) {
          headers['Content-Length'] = String(bytes.byteLength);
        }
        return new Response(bytes.slice(), { status: 200, headers });
      }
    }
  };
  return { env, seen };
}

async function call({ method = 'GET', headers = {}, envOptions } = {}) {
  const { env, seen } = createEnvironment(envOptions);
  const request = new Request('https://portfolio.test/video.mp4', { method, headers });
  const response = await serveWithRange({ request, env });
  return { request, response, seen };
}

// --- Fatias válidas ---------------------------------------------------------

const fatias = [
  { range: 'bytes=0-99', inicio: 0, fim: 99 },
  { range: 'bytes=250-', inicio: 250, fim: 255 },           // aberto
  { range: 'bytes=-50', inicio: 206, fim: 255 },            // sufixo
  { range: 'bytes=-999', inicio: 0, fim: 255 },             // sufixo maior que o arquivo
  { range: 'bytes=100-999', inicio: 100, fim: 255 }         // fim além: trunca
];

for (const caso of fatias) {
  const { response } = await call({ headers: { Range: caso.range } });
  const esperado = sourceBytes.slice(caso.inicio, caso.fim + 1);
  assert.equal(response.status, 206, `${caso.range}: deve retornar 206`);
  assert.equal(response.headers.get('Content-Range'), `bytes ${caso.inicio}-${caso.fim}/256`);
  assert.equal(response.headers.get('Content-Length'), String(esperado.byteLength));
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), esperado,
    `${caso.range}: bytes errados`);
}

// Sem o Content-Length anunciado, a validação acontece após a leitura — o
// resultado tem que ser o mesmo.
{
  const { response } = await call({
    headers: { Range: 'bytes=-50' },
    envOptions: { omitContentLength: true }
  });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), 'bytes 206-255/256');
}

// --- Ranges que a RFC 9110 manda ignorar: asset inteiro, 200 ---------------

const ignorados = [
  'bytes=1-0',                 // invertido
  'bytes=0-1,3-4',             // multi-range
  'items=0-1',                 // unidade desconhecida
  'bytes=abc',                 // lixo
  'bytes=9999999999999999-'    // dígitos além do limite do parser
];

for (const range of ignorados) {
  const { response, request, seen } = await call({ headers: { Range: range } });
  assert.equal(response.status, 200, `${range}: deve ser ignorado com 200`);
  assert.equal(seen.request, request, `${range}: a requisição deve seguir intacta`);
  assert.equal((await response.arrayBuffer()).byteLength, 256);
}

// --- 416: satisfazível em tese, mas não neste arquivo -----------------------

const insatisfativeis = [
  { headers: { Range: 'bytes=999-1000' } },
  { headers: { Range: 'bytes=-0' } },
  { headers: { Range: 'bytes=0-9' }, envOptions: { bytes: new Uint8Array(0) } }
];

for (const caso of insatisfativeis) {
  const { response } = await call(caso);
  const tamanho = caso.envOptions?.bytes?.byteLength ?? 256;
  assert.equal(response.status, 416, `${caso.headers.Range}: deve retornar 416`);
  assert.equal(response.headers.get('Content-Range'), `bytes */${tamanho}`);
}

// --- Repasse: método e condicionais preservados -----------------------------

{
  // Sem Range, a requisição original vai intacta — com If-None-Match e tudo.
  const { request, response, seen } = await call({
    headers: { 'If-None-Match': '"abc"' }
  });
  assert.equal(response.status, 200);
  assert.equal(seen.request, request, 'sem Range: repasse deve ser a requisição original');
  assert.equal(seen.request.headers.get('If-None-Match'), '"abc"');
}

{
  // HEAD com Range tem semântica indefinida: repassa como veio, sem fatiar.
  const { request, seen } = await call({
    method: 'HEAD',
    headers: { Range: 'bytes=0-1' }
  });
  assert.equal(seen.request, request, 'HEAD: repasse deve ser a requisição original');
  assert.equal(seen.request.method, 'HEAD');
}

// --- If-Range ----------------------------------------------------------------

{
  // Validador atual: a fatia sai, com os validadores propagados no 206.
  const { response } = await call({
    headers: { Range: 'bytes=0-9', 'If-Range': '"v2"' },
    envOptions: { headers: { ETag: '"v2"', 'Last-Modified': 'Wed, 01 Jan 2025 00:00:00 GMT' } }
  });
  assert.equal(response.status, 206, 'If-Range atual: deve fatiar');
  assert.equal(response.headers.get('ETag'), '"v2"');
  assert.equal(response.headers.get('Last-Modified'), 'Wed, 01 Jan 2025 00:00:00 GMT');
}

{
  // Validador de um arquivo antigo: o arquivo NOVO vai inteiro, nunca fatiado.
  const { response } = await call({
    headers: { Range: 'bytes=0-9', 'If-Range': '"v1"' },
    envOptions: { headers: { ETag: '"v2"' } }
  });
  assert.equal(response.status, 200, 'If-Range desatualizado: deve mandar o arquivo inteiro');
  assert.equal((await response.arrayBuffer()).byteLength, 256);
}

// --- As rotas são invólucros da lib ------------------------------------------

for (const rota of [
  '../functions/assets/video/[[path]].js',
  '../functions/lps/[lp]/media/[[path]].js'
]) {
  const source = await readFile(new URL(rota, import.meta.url), 'utf8');
  assert.match(source, /_lib\/range\.js/, `${rota}: deve importar a lib compartilhada`);
  assert.match(source, /export const onRequest = serveWithRange/,
    `${rota}: deve exportar a lib sem lógica própria`);
}

console.log('ok - functions/_lib/range.js');
console.log(`Range: ${fatias.length + ignorados.length + insatisfativeis.length + 6} cenários na lib + 2 rotas conferidas`);
