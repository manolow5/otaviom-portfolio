// Suporte a HTTP Range (206) para os vídeos de scrub. O Pages responde 200
// para Range em assets estáticos, o que impede o Chrome de buscar um ponto
// específico do vídeo e congela o scrub por scroll.
//
// A lógica vive aqui, compartilhada pelas rotas /assets/video/* e
// /lps/[lp]/media/* — eram duas cópias e já divergiram uma vez.
//
// Decisões de protocolo (RFC 9110, seção Range):
// - Range malformado, unidade desconhecida, multi-range e intervalo invertido
//   são IGNORADOS: o asset vai inteiro com 200. A RFC trata Range como
//   opcional, e 400 aqui quebrava clientes legítimos.
// - 416 fica só para o caso satisfazível em tese mas não neste arquivo:
//   início além do fim do arquivo, ou sufixo que não rende nenhum byte.
// - If-Range com validador que não bate com o asset atual devolve o arquivo
//   inteiro — nunca uma fatia de versão misturada com download antigo.

// Aceita "bytes=A-B", "bytes=A-" e "bytes=-N". Dígitos limitados a 15: acima
// disso é abuso, e números dessa ordem já não cabem em arquivo nenhum daqui.
const RANGE_RE = /^bytes=(\d{0,15})-(\d{0,15})$/;

export async function serveWithRange({ request, env }) {
  const spec = parseRange(request.headers.get('Range'));

  // Sem fatia a fazer — inclusive HEAD, cuja combinação com Range tem
  // semântica indefinida — a requisição segue intacta para o Pages, com
  // método e cabeçalhos condicionais preservados.
  if (!spec || request.method !== 'GET') {
    return env.ASSETS.fetch(request);
  }

  // Busca sem os condicionais do cliente: um 304 aqui não teria corpo para
  // fatiar. O If-Range é avaliado à mão logo abaixo.
  const asset = await env.ASSETS.fetch(new Request(request.url));
  if (!asset.ok) return asset;

  const etag = asset.headers.get('ETag');
  const lastModified = asset.headers.get('Last-Modified');
  const ifRange = request.headers.get('If-Range');
  if (ifRange && ifRange !== etag && ifRange !== lastModified) {
    return asset;
  }

  // Valida contra o tamanho anunciado ANTES de ler o corpo: um Range
  // inválido não pode custar a leitura do vídeo inteiro. Para um Range
  // válido a leitura completa é inevitável — o ASSETS não sabe buscar um
  // trecho — mas aí o custo é o do serviço prestado.
  const declaredSize = Number.parseInt(asset.headers.get('Content-Length') ?? '', 10);
  if (Number.isFinite(declaredSize)) {
    const bounds = resolveBounds(spec, declaredSize);
    if (!bounds) {
      await discard(asset);
      return rangeNotSatisfiable(declaredSize);
    }
  }

  const buffer = await asset.arrayBuffer();
  const size = buffer.byteLength;
  const bounds = resolveBounds(spec, size);
  if (!bounds) return rangeNotSatisfiable(size);

  const headers = {
    'Content-Type': asset.headers.get('Content-Type') || 'video/mp4',
    'Content-Range': `bytes ${bounds.start}-${bounds.end}/${size}`,
    'Content-Length': String(bounds.end - bounds.start + 1),
    'Accept-Ranges': 'bytes',
    'Cache-Control': asset.headers.get('Cache-Control') || 'public, max-age=3600'
  };
  if (etag) headers.ETag = etag;
  if (lastModified) headers['Last-Modified'] = lastModified;

  return new Response(buffer.slice(bounds.start, bounds.end + 1), {
    status: 206,
    headers
  });
}

// Devolve o pedido interpretado, ou null quando a RFC manda ignorar o header.
function parseRange(header) {
  if (!header) return null;
  const match = RANGE_RE.exec(header.trim());
  if (!match) return null;
  const [, first, last] = match;
  if (first === '' && last === '') return null;
  if (first === '') return { suffix: Number.parseInt(last, 10) };
  const start = Number.parseInt(first, 10);
  const end = last === '' ? null : Number.parseInt(last, 10);
  if (end !== null && end < start) return null; // invertido: ignora, não 416
  return { start, end };
}

// Traduz o pedido para posições concretas; null quando não há byte a servir.
function resolveBounds(spec, size) {
  if (size === 0) return null;
  if (spec.suffix !== undefined) {
    if (spec.suffix <= 0) return null;
    return { start: Math.max(0, size - spec.suffix), end: size - 1 };
  }
  if (spec.start >= size) return null;
  return { start: spec.start, end: Math.min(spec.end ?? size - 1, size - 1) };
}

function rangeNotSatisfiable(size) {
  return new Response(null, {
    status: 416,
    headers: {
      'Content-Range': `bytes */${size}`,
      'Accept-Ranges': 'bytes'
    }
  });
}

// Libera o corpo não consumido sem baixá-lo.
async function discard(response) {
  try {
    await response.body?.cancel();
  } catch {
    // corpo já consumido ou ausente; nada a liberar
  }
}
