"""Verificação do portfólio num Chrome de verdade.

Cobre o que teste de arquivo não pega: regressão de layout por especificidade de
CSS, o scrub movendo o vídeo, a troca de idioma e o preview no hover.

Antes de rodar:
    python3 serve.py 8091                    # da raiz do repo (tem HTTP Range)
    <chrome> --headless=new --no-sandbox --remote-debugging-port=9222 \
        --window-size=1440,1000 --user-data-dir=/tmp/perfil about:blank

    python3 portfolio/tests/browser_check.py

Sai com código 1 se alguma verificação falhar.
"""
import json
import os
import sys
import time
from pathlib import Path

AQUI = Path(__file__).resolve().parent
# O cliente CDP mora em tools/browser/ no repo lps e ao lado deste arquivo no
# repo do portfólio publicado.
for candidato in (AQUI, AQUI.parents[1] / "tools" / "browser", AQUI.parents[0] / "tools" / "browser"):
    if (candidato / "cdp.py").exists():
        sys.path.insert(0, str(candidato))
        break
from cdp import CDP  # noqa: E402

# PORTFOLIO_URL permite apontar para outra raiz sem editar o teste.
URL = os.environ.get("PORTFOLIO_URL", "http://localhost:8091/portfolio/public/")
# O headless não tem apontador: sem este stub o caminho de desktop do preview
# nunca é exercitado, porque (hover: hover) dá falso.
HOVER_STUB = """(() => {
  const real = window.matchMedia.bind(window);
  window.matchMedia = q => (/hover:\\s*hover|any-hover:\\s*hover/.test(q)
    ? {matches: true, media: q, addEventListener(){}, removeEventListener(){},
       addListener(){}, removeListener(){}}
    : real(q));
})();"""

resultados = []


def checar(nome, ok, obtido):
    resultados.append((nome, bool(ok), str(obtido)))


LAYOUT = """(() => {
  const px = s => parseFloat(s);
  const g = (sel, prop) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el)[prop] : null;
  };
  const alt = sel => {
    const el = document.querySelector(sel);
    return el ? Math.round(el.getBoundingClientRect().height) : -1;
  };
  const bg = getComputedStyle(document.body).backgroundColor;
  return JSON.stringify({
    heroH1: px(g('#topo h1', 'fontSize')),
    secTitle: px(g('.sec-title', 'fontSize')),
    aboutLead: px(g('.about-lead', 'fontSize')),
    contactTitle: px(g('.contact-title', 'fontSize')),
    skillH3: px(g('.skill h3', 'fontSize')),
    caseDd: px(g('.case-body dd', 'fontSize')),
    caseHeadH: alt('.case-head'),
    workVidPos: g('.work-vid', 'position'),
    workDisplay: g('.work', 'display'),
    whatsapp: (el => el ? el.getAttribute('href') : null)(document.querySelector('#link-whatsapp')),
    whatsappVisivel: g('#link-whatsapp', 'display') !== 'none',
    github: (el => el ? el.getAttribute('href') : null)(document.querySelector('#link-github')),
    githubVisivel: g('#link-github', 'display') !== 'none',
    emailHref: (el => el ? el.getAttribute('href') : null)(document.querySelector('.contact-links .btn')),
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    invisiveis: [...document.querySelectorAll('p, h1, h2, h3, dd, dt, span')]
      .filter(el => el.textContent.trim() && getComputedStyle(el).color === bg).length,
    colapsadas: ['#fazer','#trabalho','#casos','#bastidores','#sobre','#contato']
      .filter(s => alt(s) < 200)
  });
})()"""


def verificar_layout(c, rotulo, largura, altura):
    c.call("Emulation.setDeviceMetricsOverride", width=largura, height=altura,
           deviceScaleFactor=1, mobile=largura < 500)
    c.navigate(URL, settle=2.0)
    d = json.loads(c.eval_js(LAYOUT))
    p = f"[{rotulo}] "
    checar(p + "hero grande", d["heroH1"] >= 44, d["heroH1"])
    checar(p + "titulo de secao grande", d["secTitle"] >= 32, d["secTitle"])
    checar(p + "abertura do sobre grande", d["aboutLead"] >= 26, d["aboutLead"])
    checar(p + "titulo de contato grande", d["contactTitle"] >= 34, d["contactTitle"])
    checar(p + "subtitulo de habilidade legivel", d["skillH3"] >= 19, d["skillH3"])
    checar(p + "ficha de caso legivel", d["caseDd"] >= 14, d["caseDd"])
    # 100vh vazando do hero para o <header> dos cards já quebrou isto antes.
    checar(p + "cabecalho de caso baixo", d["caseHeadH"] < 130, f"{d['caseHeadH']}px")
    # Se virar item do grid, a faixa do mostruário desmonta.
    checar(p + "painel de video fora do fluxo", d["workVidPos"] == "absolute", d["workVidPos"])
    checar(p + "faixa em grid", d["workDisplay"] == "grid", d["workDisplay"])
    # Placeholder publicado é link quebrado no ar: o número e o usuário são reais.
    checar(p + "whatsapp real e visivel",
           d["whatsappVisivel"] and d["whatsapp"] == "https://wa.me/5519982674837",
           d["whatsapp"])
    checar(p + "github real e visivel",
           d["githubVisivel"] and d["github"] == "https://github.com/manolow5",
           d["github"])
    checar(p + "email correto", d["emailHref"] == "mailto:spellagenciabr@gmail.com",
           d["emailHref"])
    checar(p + "sem scroll lateral", d["scrollW"] <= d["innerW"] + 1,
           f"{d['scrollW']} vs {d['innerW']}")
    checar(p + "sem texto invisivel", d["invisiveis"] == 0, d["invisiveis"])
    checar(p + "nenhuma secao colapsada", not d["colapsadas"],
           ",".join(d["colapsadas"]) or "ok")


def verificar_comportamento(c):
    c.call("Emulation.clearDeviceMetricsOverride")
    c.navigate(URL, settle=1.0)

    # Visitante novo, navegador em inglês (o headless é en-US): tem que abrir em
    # português. O idioma do navegador não decide nada.
    c.eval_js("localStorage.removeItem('otaviom.lang'); 'ok'")
    c.navigate(URL.split("?")[0], settle=2.5)
    primeira = c.eval_js("""document.documentElement.lang + '|' + navigator.language
      + '|' + document.querySelector('.nav-link').textContent""")
    checar("visitante novo abre em pt mesmo com navegador en",
           primeira.startswith("pt-BR") and "trabalho" in primeira, primeira)

    c.navigate(URL, settle=3.0)

    est = json.loads(c.eval_js("""JSON.stringify({
      cls: document.documentElement.className,
      lang: document.documentElement.lang,
      scrubH: Math.round(document.getElementById('scrubwrap').getBoundingClientRect().height),
      desligado: document.getElementById('scrubwrap').classList.contains('disabled'),
      prontidao: document.getElementById('scrubvid').readyState,
      duracao: document.getElementById('scrubvid').duration,
      revelados: document.querySelectorAll('.fx.on').length,
      poster: document.querySelector('.work .work-vid').style.backgroundImage.slice(0, 44)
    })"""))
    checar("classe js aplicada", "js" in est["cls"], est["cls"])
    checar("corredor liberado", est["scrubH"] > 1000, f"{est['scrubH']}px")
    checar("scrub ativo", not est["desligado"], est["desligado"])
    checar("video com metadata", est["prontidao"] >= 1 and est["duracao"] > 3,
           f"readyState={est['prontidao']} dur={est['duracao']}")
    checar("reveals dispararam", est["revelados"] > 0, est["revelados"])
    checar("poster no card", "poster-" in est["poster"], est["poster"])
    checar("idioma inicial pt", est["lang"] == "pt-BR", est["lang"])

    # scrub: rolar até o meio do corredor e ver o currentTime andar
    c.eval_js("""(() => {
      const w = document.getElementById('scrubwrap');
      const y = w.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.round(y + (w.offsetHeight - window.innerHeight) * 0.55));
      return 'ok';
    })()""")
    time.sleep(2.0)
    meio = json.loads(c.eval_js("""JSON.stringify({
      tempo: document.getElementById('scrubvid').currentTime,
      legendas: document.querySelectorAll('.scrub-cap.show').length,
      barra: getComputedStyle(document.getElementById('pbar')).transform,
      stickyTop: Math.round(document.querySelector('.scrub-sticky').getBoundingClientRect().top)
    })"""))
    checar("scrub moveu o video", meio["tempo"] > 0.5, f"{round(meio['tempo'], 2)}s")
    # overflow-x: hidden num ancestral já fez o sticky parar de colar aqui.
    checar("corredor colado no topo", abs(meio["stickyTop"]) <= 2, f"top={meio['stickyTop']}px")
    checar("legenda visivel", meio["legendas"] >= 1, meio["legendas"])
    checar("barra de progresso andou",
           "matrix" in meio["barra"] and meio["barra"] != "matrix(0, 0, 0, 1, 0, 0)",
           meio["barra"])

    # i18n
    c.eval_js("window.scrollTo(0,0); document.querySelector('.lang-btn[data-lang=\"en\"]').click(); 'ok'")
    time.sleep(2.0)
    en = json.loads(c.eval_js("""JSON.stringify({
      lang: document.documentElement.lang,
      h1: document.querySelector('#topo h1').textContent.slice(0, 34),
      nav: document.querySelector('.nav-link').textContent,
      titulo: document.title.slice(0, 30),
      url: location.search,
      ativo: document.querySelector('.lang-btn.is-on').dataset.lang,
      presos: [...document.querySelectorAll('[data-i18n]')]
        .filter(e => /ção|ões|história|trabalho|você/.test(e.textContent)).length
    })"""))
    checar("html lang = en", en["lang"] == "en", en["lang"])
    checar("hero traduzido", "design" in en["h1"].lower(), en["h1"])
    checar("nav traduzida", en["nav"] == "work", en["nav"])
    checar("title traduzido", en["titulo"].strip() != "", en["titulo"])
    checar("url compartilhavel", "lang=en" in en["url"], en["url"] or "(vazia)")
    checar("botao en ativo", en["ativo"] == "en", en["ativo"])
    checar("nenhum texto preso em pt", en["presos"] == 0, en["presos"])

    c.eval_js("document.querySelector('.lang-btn[data-lang=\"pt\"]').click(); 'ok'")
    time.sleep(1.5)
    volta = c.eval_js("document.documentElement.lang + '|' + document.querySelector('#topo h1').textContent.slice(0,20)")
    checar("volta para pt", volta.startswith("pt-BR") and "desenho" in volta, volta)

    c.navigate(URL + "?lang=en", settle=2.5)
    direto = c.eval_js("document.documentElement.lang + '|' + document.querySelector('.nav-link').textContent")
    checar("?lang=en no link", direto.startswith("en") and "work" in direto, direto)


def verificar_preview(c):
    """Preview só carrega no hover: nada de vídeo antes do mouse chegar."""
    c.call("Page.enable")
    c.call("Page.addScriptToEvaluateOnNewDocument", source=HOVER_STUB)
    c.navigate(URL, settle=2.5)

    antes = c.eval_js("[...document.querySelectorAll('.work video')].filter(v => v.getAttribute('src')).length")
    checar("nenhum preview antes do hover", int(antes) == 0, antes)

    c.eval_js("""(() => {
      const w = document.querySelectorAll('.work')[1];
      window.scrollTo(0, Math.round(w.getBoundingClientRect().top + window.scrollY - 260));
      return 'ok';
    })()""")
    time.sleep(0.8)
    c.eval_js("document.querySelectorAll('.work')[1].dispatchEvent(new MouseEvent('mouseenter')); 'ok'")
    time.sleep(3.0)
    dep = json.loads(c.eval_js("""(() => {
      const v = document.querySelectorAll('.work')[1].querySelector('video');
      return JSON.stringify({src: v.getAttribute('src'), pausado: v.paused, tempo: v.currentTime});
    })()"""))
    checar("preview carregou no hover", (dep["src"] or "").startswith("assets/video/prev-"), dep["src"])
    checar("preview esta tocando", not dep["pausado"] and dep["tempo"] > 0,
           f"pausado={dep['pausado']} t={round(dep['tempo'], 2)}")

    c.eval_js("document.querySelectorAll('.work')[1].dispatchEvent(new MouseEvent('mouseleave')); 'ok'")
    time.sleep(0.8)
    checar("preview pausa ao sair",
           c.eval_js("document.querySelectorAll('.work')[1].querySelector('video').paused") is True,
           "pausado")

    # Todo card do mostruário aponta para o preview e o poster da sua própria LP.
    # A giro entrou por último e o buraco foi exatamente este: o prev-giro.mp4
    # existia no disco e o data-prev não, então o card nunca pedia o vídeo — e o
    # build não tem como perceber, porque para ele o arquivo está lá.
    cards = json.loads(c.eval_js("""(() => {
      const itens = [...document.querySelectorAll('.work')];
      const falhas = itens.map(w => {
        const lp = w.getAttribute('href').replace(/.*lps\\/|\\/$/g, '');
        const prev = w.dataset.prev || '';
        const poster = w.querySelector('.work-vid').style.backgroundImage || '';
        const ok = prev === `assets/video/prev-${lp}.mp4` && poster.includes(`poster-${lp}`);
        return ok ? null : `${lp}(prev=${prev || 'nenhum'})`;
      }).filter(Boolean);
      return JSON.stringify({total: itens.length, falhas});
    })()"""))
    checar("todo card tem o preview e o poster da sua LP",
           cards["total"] == 7 and not cards["falhas"],
           f"{cards['total']} cards, falhas: {cards['falhas'] or 'nenhuma'}")


def main():
    c = CDP.connect(port=9222)
    c.call("Network.enable")
    # Sem isto o CSS recém-editado volta do cache e a verificação mente.
    c.call("Network.setCacheDisabled", cacheDisabled=True)

    verificar_layout(c, "desktop", 1440, 1000)
    verificar_layout(c, "mobile", 390, 844)
    c.call("Emulation.clearDeviceMetricsOverride")
    verificar_comportamento(c)
    verificar_preview(c)

    falhas = [r for r in resultados if not r[1]]
    for nome, _, obtido in falhas:
        print(f"  FALHOU  {nome}: {obtido}")
    print(f"\n{len(resultados) - len(falhas)}/{len(resultados)} verificações passaram")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
