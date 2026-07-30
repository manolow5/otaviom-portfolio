// Serve /assets/video/* com suporte a HTTP Range (206). O Pages responde 200
// para Range em assets estaticos, o que impede o Chrome de buscar um ponto
// especifico do video e congela o scrub por scroll.
export async function onRequest({ request, env }) {
  const asset = await env.ASSETS.fetch(new Request(request.url));
  const range = request.headers.get('Range');

  if (!range || !asset.ok) return asset;

  const buffer = await asset.arrayBuffer();
  const size = buffer.byteLength;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());

  if (!match || (match[1] === '' && match[2] === '')) {
    return new Response('Invalid Range', { status: 400 });
  }

  let start;
  let end;

  if (match[1] === '') {
    const suffixLength = Number.parseInt(match[2], 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0 || size === 0) {
      return rangeNotSatisfiable(size);
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number.parseInt(match[1], 10);
    end = match[2] === '' ? size - 1 : Number.parseInt(match[2], 10);
  }

  end = Math.min(end, size - 1);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    start > end ||
    start >= size
  ) {
    return rangeNotSatisfiable(size);
  }

  return new Response(buffer.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': asset.headers.get('Content-Type') || 'video/mp4',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600'
    }
  });
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
