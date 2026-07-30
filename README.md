# otaviom — portfólio

Site de uma página, estático, sem framework e sem build de JavaScript. Serve, no
mesmo domínio, as oito landing pages narrativas que ele apresenta: clicar em uma
peça do mostruário abre a peça de verdade, não um print dela.

Publicado no Cloudflare Pages.

## O que tem de interessante aqui

**Scrub de vídeo por scroll.** Nas LPs e no hero deste portfólio o scroll não
rola a página: ele move o `currentTime` de um vídeo. O que faz isso funcionar não
é o JavaScript, são três detalhes de infraestrutura:

1. O vídeo precisa ser re-encodado com quadros-chave densos (`-g 4`). Vídeo
   gerado costuma vir com um ou dois keyframes no arquivo inteiro, e cada busca
   passa a decodificar centenas de quadros — o scrub engasga.
2. O servidor precisa responder **`206 Partial Content`**. Se devolver o arquivo
   inteiro com `200`, o Chrome trata o vídeo como não-buscável, `currentTime`
   vira no-op e o efeito morre **em silêncio**: sem erro no console, sem aviso.
   O Cloudflare Pages devolve `200` para assets estáticos, então há uma Pages
   Function em `functions/` fatiando o arquivo na mão.
3. O seek precisa de trava. Emitir um `currentTime` por evento de scroll trava a
   aba em vídeo pesado; o loop usa `requestAnimationFrame` com easing e só emite
   o próximo seek depois do evento `seeked`.

O padrão inteiro está documentado em [PADRAO-LP-HISTORIA.md](PADRAO-LP-HISTORIA.md).

**Bilíngue sem duplicar rota.** Toda a copy sai do HTML para `pt.json` e
`en.json` (91 chaves em cada), e os elementos carregam `data-i18n`. pt-BR é o
padrão sempre — o idioma do navegador é ignorado de propósito, para ninguém
receber o site traduzido sem ter pedido. O inglês entra por escolha explícita: o
botão da nav, que persiste em `localStorage`, ou `?lang=en`, que é um link
compartilhável.

**Degrada de propósito.** A classe `js` só entra no `<html>` se o `site.js`
carregar de fato. Sem ela o CSS mostra todo o conteúdo de uma vez e colapsa a
seção do corredor, em vez de deixar a página em branco esperando um reveal que
nunca vem ou um bloco preto onde o vídeo deveria estar.

## Estrutura

```
public/
  index.html                  # a página inteira
  assets/css/site.css
  assets/js/site.js           # i18n, reveals, scrub do hero, preview no hover
  assets/i18n/{pt,en}.json    # toda a copy
  assets/video/, assets/img/  # gerados pelo build
  lps/<lp>/                   # copiado pelo build
functions/
  lps/[lp]/media/[[path]].js  # HTTP Range para os vídeos das LPs
  assets/video/[[path]].js    # HTTP Range para o vídeo do hero
lps/<lp>/                     # as oito LPs (fonte)
build.sh
tests/
serve.py                      # servidor local com suporte a Range
```

## Rodar

```bash
bash build.sh                    # copia as LPs e gera os assets leves
python3 serve.py 8090 public     # http.server não faz Range; este faz
```

Depois abra `http://localhost:8090`. Conferir o Range antes de qualquer deploy:

```bash
curl -I -H "Range: bytes=0-1" http://localhost:8090/assets/video/hero-scrub.mp4
# 206, não 200
```

## Assets

Os vídeos das LPs somam 42 MB e **não são versionados** — num clone limpo o
`build.sh` avisa e para. Eles são gerados localmente (ComfyUI + Wan 2.2, 15s em
720p por peça) e re-encodados com o comando de keyframes do padrão. Os 161
quadros `.webp` da `giro` estão aqui porque ela é a exceção: o giro de 360° é
desenhado num `canvas` a partir de imagens, não de vídeo, e foi assim que a lupa
ficou nítida em qualquer ponto da volta.

O build também gera, para cada LP com screencast, um preview de ~6s em 720×450 e
um poster do primeiro quadro. O preview só é baixado no `mouseenter`, e em tela
de toque nem existe: no lugar dele cada peça leva uma marca na sua própria cor.

## Testes

```bash
node tests/range.test.mjs   # as Functions de Range: 206, 416, sufixo, sem Range
node tests/i18n.test.mjs    # paridade das chaves entre os dois idiomas
```

E a verificação no navegador, que é a única que pega regressão de layout por
especificidade de CSS e a única que prova que o scrub move o vídeo, que o idioma
troca e que o preview só carrega no hover:

```bash
python3 serve.py 8090 public
<chrome> --headless=new --no-sandbox --remote-debugging-port=9222 \
    --window-size=1440,1000 --user-data-dir=/tmp/perfil about:blank
PORTFOLIO_URL=http://localhost:8090/ python3 tests/browser_check.py
```

São 56 verificações em 1440px e 390px. Ela desliga o cache do navegador antes de
medir — sem isso o CSS recém-editado volta do cache e o teste passa mentindo.

Se estiver rodando em WSL, o Chrome precisa ser o do Linux. O `chrome.exe` do
Windows sobe e anuncia o CDP, mas escuta no `127.0.0.1` do lado do Windows, que o
WSL não alcança: a porta 9222 responde vazio e parece que o navegador não subiu.

## Deploy

O `wrangler` só empacota o `functions/` do diretório de onde é chamado:

```bash
npx wrangler pages deploy public --project-name otaviom
```

Depois do deploy, a verificação que não pode ser pulada — se ela falhar, o scrub
quebra em todas as páginas ao mesmo tempo e sem sinal nenhum:

```bash
for lp in ata avesso bamboo brasa halo memo orbita; do
  curl -o /dev/null -s -w "$lp %{http_code}\n" \
    -H "Range: bytes=0-1" https://<domínio>/lps/$lp/media/corredor-scrub.mp4
done
# a giro usa giro-scrub.mp4; e se o edge tiver cacheado um 200 antigo, versione a URL
```

## Sobre as peças

As sete LPs do mostruário são estudos de estilo para marcas fictícias: cada uma
testa a mesma gramática narrativa num nicho diferente. A oitava, `ata`, é a
landing page de um produto real e por isso fica fora do mostruário — ela aparece
dentro do caso técnico do produto.

— José Otávio ([spellagenciabr@gmail.com](mailto:spellagenciabr@gmail.com))
