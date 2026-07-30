(function () {
  'use strict';

  var scrollTasks = [];
  var scrollFrame = null;

  function ignoreError() {}

  function startFeature(initializer) {
    try {
      var result = initializer();
      if (result && typeof result.catch === 'function') {
        result.catch(ignoreError);
      }
    } catch (error) {
      // Cada recurso e progressivo. Uma falha nao pode impedir os demais.
    }
  }

  function addScrollTask(task) {
    scrollTasks.push(task);
  }

  function runScrollTasks() {
    scrollFrame = null;
    for (var i = 0; i < scrollTasks.length; i += 1) {
      try {
        scrollTasks[i]();
      } catch (error) {
        // Mantem os outros recursos de scroll ativos.
      }
    }
  }

  function scheduleScrollTasks() {
    if (scrollFrame === null) {
      scrollFrame = window.requestAnimationFrame(runScrollTasks);
    }
  }

  function initI18n() {
    var buttons = Array.prototype.slice.call(
      document.querySelectorAll('.lang-btn[data-lang]')
    );
    var dictionaries = Object.create(null);
    var activeLanguage = 'pt';
    // A última escolha do visitante, registrada ANTES do fetch resolver.
    // Sem isto, clicar PT e depois EN durante o carregamento terminava em PT:
    // o clique era comparado com um activeLanguage ainda antigo.
    var wantedLanguage = 'pt';

    function supportedLanguage(value) {
      return value === 'en' ? 'en' : value === 'pt' ? 'pt' : null;
    }

    function readStoredLanguage() {
      try {
        return supportedLanguage(window.localStorage.getItem('otaviom.lang'));
      } catch (error) {
        return null;
      }
    }

    // pt-BR é o padrão, sempre. O idioma do navegador não entra na conta: o site
    // é escrito em português e o inglês existe para quando alguém pede, pelo
    // botão ou por ?lang=en num link compartilhado.
    function initialLanguage() {
      var queryLanguage = null;
      try {
        queryLanguage = supportedLanguage(
          new URL(window.location.href).searchParams.get('lang')
        );
      } catch (error) {}

      if (queryLanguage) return queryLanguage;

      return readStoredLanguage() || 'pt';
    }

    function updateLanguageControls(language) {
      activeLanguage = language;
      document.documentElement.lang = language === 'en' ? 'en' : 'pt-BR';

      buttons.forEach(function (button) {
        var isActive = button.dataset.lang === language;
        button.classList.toggle('is-on', isActive);
        button.setAttribute('aria-pressed', String(isActive));
      });
    }

    function loadDictionary(language) {
      if (dictionaries[language]) {
        return Promise.resolve(dictionaries[language]);
      }

      var source = new URL(
        'assets/i18n/' + language + '.json',
        document.baseURI
      );

      return window.fetch(source.toString(), { credentials: 'same-origin' })
        .then(function (response) {
          if (!response.ok) {
            throw new Error('Falha ao carregar idioma');
          }
          return response.json();
        })
        .then(function (dictionary) {
          dictionaries[language] = dictionary;
          return dictionary;
        });
    }

    function applyDictionary(dictionary) {
      document.querySelectorAll('[data-i18n]').forEach(function (element) {
        var key = element.dataset.i18n;
        if (Object.prototype.hasOwnProperty.call(dictionary, key)) {
          element.textContent = dictionary[key];
        }
      });

      document.querySelectorAll('[data-i18n-html]').forEach(function (element) {
        var key = element.dataset.i18nHtml;
        if (Object.prototype.hasOwnProperty.call(dictionary, key)) {
          element.innerHTML = dictionary[key];
        }
      });

      document.querySelectorAll('[data-i18n-attr]').forEach(function (element) {
        var binding = element.dataset.i18nAttr;
        var separator = binding.indexOf(':');
        if (separator < 1) return;

        var attribute = binding.slice(0, separator);
        var key = binding.slice(separator + 1);
        if (Object.prototype.hasOwnProperty.call(dictionary, key)) {
          element.setAttribute(attribute, dictionary[key]);
        }
      });
    }

    function saveLanguage(language) {
      try {
        window.localStorage.setItem('otaviom.lang', language);
      } catch (error) {}
    }

    function updateLanguageUrl(language) {
      try {
        var url = new URL(window.location.href);
        url.searchParams.set('lang', language);
        window.history.replaceState(
          null,
          '',
          url.pathname + url.search + url.hash
        );
      } catch (error) {}
    }

    function selectLanguage(language, options) {
      var selected = supportedLanguage(language);
      if (!selected) return Promise.resolve(false);
      wantedLanguage = selected;

      if (selected === 'pt' && options.initial) {
        updateLanguageControls('pt');
        return Promise.resolve(true);
      }

      return loadDictionary(selected)
        .then(function (dictionary) {
          // Outra escolha chegou enquanto este dicionário carregava: o último
          // clique manda, e esta resposta é descartada.
          if (wantedLanguage !== selected) return false;
          applyDictionary(dictionary);
          updateLanguageControls(selected);
          if (options.persist) saveLanguage(selected);
          if (options.updateUrl) updateLanguageUrl(selected);
          scheduleScrollTasks();
          return true;
        })
        .catch(function () {
          if (options.initial && wantedLanguage === selected) {
            updateLanguageControls('pt');
          }
          return false;
        });
    }

    updateLanguageControls('pt');

    buttons.forEach(function (button) {
      button.addEventListener('click', function () {
        var language = supportedLanguage(button.dataset.lang);
        // Compara com a escolha mais recente, não com o idioma já aplicado:
        // durante um carregamento, os dois divergem.
        if (!language || language === wantedLanguage) return;
        selectLanguage(language, {
          initial: false,
          persist: true,
          updateUrl: true
        });
      });
    });

    return selectLanguage(initialLanguage(), {
      initial: true,
      persist: false,
      updateUrl: false
    });
  }

  function initProgressBar() {
    var progressBar = document.getElementById('pbar');
    if (!progressBar) return;

    addScrollTask(function () {
      var documentElement = document.documentElement;
      var maximum = documentElement.scrollHeight - window.innerHeight;
      var progress = maximum > 0 ? window.scrollY / maximum : 0;
      progress = Math.max(0, Math.min(1, progress));
      progressBar.style.transform = 'scaleX(' + progress + ')';
    });
  }

  function initReveals() {
    var elements = Array.prototype.slice.call(document.querySelectorAll('.fx'));
    if (!elements.length) return;

    function revealVisible() {
      var limit = window.innerHeight * 0.9;
      elements.forEach(function (element) {
        if (element.classList.contains('on')) return;
        var bounds = element.getBoundingClientRect();
        if (bounds.top < limit && bounds.bottom > 0) {
          element.classList.add('on');
        }
      });
    }

    revealVisible();

    if ('IntersectionObserver' in window) {
      var observer = new window.IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('on');
          observer.unobserve(entry.target);
        });
      }, {
        rootMargin: '0px 0px -10% 0px',
        threshold: 0.01
      });

      elements.forEach(function (element) {
        if (!element.classList.contains('on')) observer.observe(element);
      });
      return;
    }

    addScrollTask(revealVisible);
  }

  function initScrub() {
    var wrapper = document.getElementById('scrubwrap');
    var video = document.getElementById('scrubvid');
    if (!wrapper || !video) return;

    var captions = Array.prototype.slice.call(
      wrapper.querySelectorAll('.scrub-cap[data-from][data-to]')
    );
    var reducedMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion) {
      captions.forEach(function (caption) {
        caption.classList.add('show');
      });
      return;
    }

    var metadataReady = false;
    var seekBusy = false;
    var smoothTime = 0;
    var targetTime = 0;
    var scrubFrame = null;

    function disableScrub() {
      metadataReady = false;
      seekBusy = false;
      if (scrubFrame !== null) {
        window.cancelAnimationFrame(scrubFrame);
        scrubFrame = null;
      }
      wrapper.classList.add('disabled');
    }

    function scrubStep() {
      var current = smoothTime || video.currentTime || 0;
      var next = current + (targetTime - current) * 0.22;
      var difference = Math.abs(next - (video.currentTime || 0));
      smoothTime = next;

      if (!seekBusy && difference > 0.034 && video.readyState > 0) {
        seekBusy = true;
        try {
          video.currentTime = next;
        } catch (error) {
          seekBusy = false;
        }
      }

      if (
        Math.abs(targetTime - next) < 0.01 &&
        difference < 0.034
      ) {
        scrubFrame = null;
        return;
      }

      scrubFrame = window.requestAnimationFrame(scrubStep);
    }

    function startScrub() {
      if (scrubFrame === null) {
        scrubFrame = window.requestAnimationFrame(scrubStep);
      }
    }

    function updateScrub() {
      if (wrapper.classList.contains('disabled')) return;

      var bounds = wrapper.getBoundingClientRect();
      var scrollableHeight = bounds.height - window.innerHeight;
      var progress = scrollableHeight > 0 ? -bounds.top / scrollableHeight : 0;
      progress = Math.max(0, Math.min(1, progress));

      captions.forEach(function (caption) {
        var from = Number(caption.dataset.from);
        var to = Number(caption.dataset.to);
        caption.classList.toggle(
          'show',
          Number.isFinite(from) &&
            Number.isFinite(to) &&
            progress >= from &&
            progress < to
        );
      });

      if (metadataReady) {
        targetTime = progress * Math.max(0, video.duration - 0.1);
        startScrub();
      }
    }

    video.muted = true;
    try {
      video.pause();
    } catch (error) {}

    video.addEventListener('error', disableScrub);
    video.addEventListener('seeked', function () {
      seekBusy = false;
    });
    video.addEventListener('loadedmetadata', function () {
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        disableScrub();
        return;
      }
      metadataReady = true;
      smoothTime = video.currentTime || 0;
      updateScrub();
    });

    if (video.error) {
      disableScrub();
      return;
    }

    if (video.readyState > 0) {
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        disableScrub();
        return;
      }
      metadataReady = true;
      smoothTime = video.currentTime || 0;
    }

    addScrollTask(updateScrub);
  }

  function initWorkPreviews() {
    var workItems = Array.prototype.slice.call(document.querySelectorAll('.work'));
    if (!workItems.length) return;

    var canHover = window.matchMedia &&
      window.matchMedia('(hover: hover)').matches;
    var reducedMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    workItems.forEach(function (item) {
      var panel = item.querySelector('.work-vid');
      var video = panel && panel.querySelector('video');
      var poster = item.dataset.poster;
      var preview = item.dataset.prev;

      // Só o dado (qual imagem). A aparência fica no CSS: opacidade inline aqui
      // venceria a folha de estilo e travaria o ajuste por breakpoint.
      if (panel && poster) {
        panel.style.backgroundImage = 'url(' + JSON.stringify(poster) + ')';
      }

      if (!panel || !video || !preview || !canHover || reducedMotion) return;

      function playPreview() {
        if (!video.getAttribute('src')) {
          video.setAttribute('src', preview);
        }
        var playback = video.play();
        if (playback && typeof playback.catch === 'function') {
          playback.catch(ignoreError);
        }
      }

      function pausePreview() {
        try {
          video.pause();
        } catch (error) {}
      }

      item.addEventListener('mouseenter', playPreview);
      item.addEventListener('mouseleave', pausePreview);
      item.addEventListener('focus', playPreview);
      item.addEventListener('blur', pausePreview);
    });
  }

  startFeature(initProgressBar);
  startFeature(initReveals);
  startFeature(initScrub);
  startFeature(initWorkPreviews);
  startFeature(initI18n);

  window.addEventListener('scroll', scheduleScrollTasks, { passive: true });
  window.addEventListener('resize', scheduleScrollTasks);
  runScrollTasks();
}());
