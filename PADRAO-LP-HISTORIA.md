# Padrão: LP com história em vídeo de fundo (scroll scrub)

Referência implementada: `lps/ata/index.html` (design "Corredor do Caos v2").

Use este padrão em LPs onde uma animação/vídeo de fundo conta uma história enquanto o visitante rola a página.

## Estrutura da página

1. **Barra de progresso** — `#pbar` fixa no topo (2px, cor de destaque), largura = % do scroll total.
2. **Nav fixa** — logo + toggle de tom da copy + CTA. Fundo translúcido com `backdrop-filter: blur`.
3. **Hero 100vh** — badge mono uppercase, H1 serif grande, sub, CTAs. Parallax no scroll (`translateY(y * 0.16)` + fade out até ~0.9vh). Hint "role para entrar" no rodapé do hero.
4. **Seção da história (`#scrubwrap`)** — o coração do padrão:
   - Wrapper com `height: 640vh` (≈ 106vh por cena; ajuste pelo nº de cenas).
   - Filho `position: sticky; top: 0; height: 100vh; overflow: hidden` com o `<video>` em `object-fit: cover`.
   - O scroll NÃO dá play: ele faz *scrub* — progresso do wrapper (0→1) mapeado para `video.currentTime`.
   - Overlay gradiente escuro em cima/embaixo para legibilidade das legendas.
   - Contador de cena (`CENA 01 / 06`) fixo no canto.
   - Uma legenda (`.cap`) por cena, alternando esquerda/direita, a última centralizada (clímax/solução). Só a cena ativa fica visível (`opacity` + `translateY`).
5. **Seção produto** — mockup (celular flutuando) com abas interativas mostrando o app.
6. **CTA final** — headline serif grande + botão com glow, gradiente radial de fundo.
7. **Footer** enxuto.

## Detalhes técnicos obrigatórios

- **Scrub suave**: nunca setar `currentTime` direto no scroll. Usar rAF com easing (`next = cur + (target - cur) * 0.22`) e trava `seekBusy` (só emite novo seek após o evento `seeked`) — senão trava em vídeos pesados.
- **Vídeo**: `muted playsinline preload="auto"`, sem áudio. **OBRIGATÓRIO re-encodar antes de usar**: vídeos gerados (Higgsfield etc.) vêm com 1-2 keyframes no arquivo inteiro, o que trava o scrub (cada seek decodifica centenas de frames). Comando validado:
  ```
  ffmpeg -i raw.mp4 -an -c:v libx264 -preset slow -crf 22 -g 4 -keyint_min 4 -sc_threshold 0 -pix_fmt yuv420p -movflags +faststart corredor-scrub.mp4
  ```
  (keyframe a cada 4 frames ≈ 0,17s; ~9 MB para 12s 1080p). Servir o arquivo local em `media/` junto da LP, não a URL do CDN de geração.
- **Servidor PRECISA suportar HTTP Range (206)**: sem `Accept-Ranges`/`206 Partial Content` o Chrome trata o vídeo como não-buscável e `currentTime` vira no-op — o scrub congela em todas as LPs. `python3 -m http.server` NÃO suporta Range; usar o `serve.py` da raiz deste repo para testes locais (`python3 serve.py 8090`). Nginx/Apache/Caddy suportam nativamente.
- **Cloudflare Pages também NÃO devolve 206** para assets estáticos: precisa de uma Pages Function interceptando `/media/*` e fatiando o asset manualmente (implementada aqui em `functions/_lib/range.js`, servindo as duas rotas). Estrutura do deploy: `public/` (site) + `functions/` lado a lado, e rodar `wrangler pages deploy public` DE DENTRO dessa pasta (o wrangler só empacota `functions/` do diretório atual). Se o edge tiver cacheado a resposta 200 antiga, versionar a URL do vídeo (`?v=2`).
- **Fallback**: listener de `error` no vídeo colapsa a seção (`height: 0`) — a página funciona sem a história.
- **Scroll handler**: um único listener `passive` com throttle via `requestAnimationFrame`.
- **Reveals**: elementos `.fx` com `opacity 0 / translateY(24px)`, revelados quando entram em `vh * 0.88`, com delay por elemento (`--fxd`).
- **`prefers-reduced-motion`**: desliga scrub e animações decorativas; legendas continuam trocando por cena.
- **Mobile**: legendas passam a ocupar a largura (left/right → full), contador e nav reduzidos.

## Padrões de conteúdo

- **Dois tons de copy** (ex.: "Confiante" / "Dramático") togglados na nav via `body[data-tone]` — cada bloco de texto tem variantes `.tone-conf` / `.tone-drama`. Bom para testar ângulos de venda.
- **Temas de cor** via CSS variables em `[data-theme="..."]` no `<html>` (ex.: noite / papel / brasa). Tudo referencia `var(--accent)` etc.
- **Tipografia**: display serif (Instrument Serif) + sans geométrica (Space Grotesk) + mono para kickers/labels (IBM Plex Mono).
- A história segue arco: problema (cenas 1–4) → virada (cena 5) → solução (cena 6, centralizada) → seção de produto → CTA.

## Geração local de vídeo (sem créditos Higgsfield)

- Servidor: ComfyUI no Windows (`C:\AI\ComfyUI\run_server.bat`) — precisa estar rodando.
- Rascunho 5s/480p (~3-4 min): `python3 tools/video/gen_video.py --fast --prompt "<cena em inglês>"` → `rascunhos/`.
- Vídeo final 15s/720p já com scrub encode (~25 min): `python3 tools/video/gen_video.py --full --lp <pasta> --prompt "..."`.
- Fluxo: 2-3 variações `--fast` → escolher → `--full` (mesma seed da variação escolhida, `--seed N`).
- Modelos: Wan 2.2 A14B GGUF Q4_K_M + LoRA Lightning 4 steps (16fps nativo; 24fps sai do ffmpeg).
- Segurança: porta 8188 liberada só para a rede do WSL; nunca expor à internet; fechar o servidor após usar.
