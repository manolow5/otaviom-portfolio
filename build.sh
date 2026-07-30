#!/usr/bin/env bash
# Monta portfolio/public/ para o deploy: copia as LPs e gera os assets leves.
# Uso: bash portfolio/build.sh [--force]
set -euo pipefail

# Roda em duas estruturas: dentro do repo `lps`, onde as LPs são pastas da raiz e
# o portfólio mora em portfolio/; e no repo do portfólio publicado, onde as LPs
# estão em lps/ ao lado do script.
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -d "$AQUI/lps" && -d "$AQUI/public" ]]; then
  LPS_DIR="$AQUI/lps"
  PUB="$AQUI/public"
  CAP="$AQUI/capturas/src"
else
  ROOT="$(cd "$AQUI/.." && pwd)"
  LPS_DIR="$ROOT"
  PUB="$AQUI/public"
  CAP="$ROOT/capturas/src"
fi
VID="$PUB/assets/video"
IMG="$PUB/assets/img"

# O WSL nem sempre carrega ~/.local/bin em shells nao interativos.
if [[ -d "$HOME/.local/bin" ]]; then
  PATH="$HOME/.local/bin:$PATH"
fi

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

LPS=(ata avesso bamboo brasa halo memo orbita giro)
HERO_FONTE="$LPS_DIR/memo/media/corredor-scrub.mp4"
HERO_DUR=4

# Keyframe a cada 4 quadros. Sem isso cada seek decodifica centenas de quadros
# e o scrub por scroll trava; ver PADRAO-LP-HISTORIA.md.
SCRUB_ENC=(-an -c:v libx264 -preset slow -crf 22 -g 4 -keyint_min 4
           -sc_threshold 0 -pix_fmt yuv420p -movflags +faststart)

for bin in ffmpeg ffprobe; do
  command -v "$bin" >/dev/null || { echo "ERRO: $bin não está no PATH."; exit 1; }
done

# Caminho do vídeo de scrub de uma LP (a giro fugiu do padrão de nome).
scrub_de() {
  case "$1" in
    giro) echo "$LPS_DIR/giro/media/giro-scrub.mp4" ;;
    *)    echo "$LPS_DIR/$1/media/corredor-scrub.mp4" ;;
  esac
}

# Verdadeiro quando a saída falta ou é mais velha que a fonte (ou com --force).
precisa() {
  local saida="$1" fonte="$2"
  (( FORCE )) && return 0
  [[ -f "$saida" && "$saida" -nt "$fonte" ]] && return 1
  return 0
}

dur_de() {
  ffprobe -v error -show_entries format=duration -of csv=p=0 "$1" | cut -d. -f1
}

# --- 1. Conferência: sem isso o deploy sobe quebrado e só se descobre no ar ---
faltando=()
for lp in "${LPS[@]}"; do
  [[ -f "$LPS_DIR/$lp/index.html" ]] || faltando+=("$lp/index.html")
  v="$(scrub_de "$lp")"
  [[ -f "$v" ]] || faltando+=("${v#$LPS_DIR/}")
done
if (( ${#faltando[@]} )); then
  echo "ERRO: arquivos obrigatórios ausentes em $LPS_DIR:"
  printf '  %s\n' "${faltando[@]}"
  echo
  echo "Os vídeos das LPs pesam 42 MB e não são versionados. Num clone limpo eles"
  echo "não existem: o build completo roda no ambiente onde os vídeos foram"
  echo "gerados. Ver a seção Assets do README."
  exit 1
fi

mkdir -p "$VID" "$IMG" "$PUB/lps"

# --- 2. LPs ---------------------------------------------------------------
echo "» copiando as LPs"
for lp in "${LPS[@]}"; do
  dest="$PUB/lps/$lp"
  rm -rf "$dest"
  mkdir -p "$dest"
  cp -r "$LPS_DIR/$lp/." "$dest/"
  # O cru pesa o dobro do usado e não vai ao ar; .bak é resto de edição.
  find "$dest" \( -name '*raw*.mp4' -o -name '*.bak' \) -delete
done
echo "  $(printf '%s ' "${LPS[@]}")"

# --- 3. Vídeo do hero -----------------------------------------------------
hero="$VID/hero-scrub.mp4"
if precisa "$hero" "$HERO_FONTE"; then
  total="$(dur_de "$HERO_FONTE")"
  # Do meio: o primeiro segundo do corredor costuma estar escuro demais.
  inicio=$(( total > HERO_DUR ? (total - HERO_DUR) / 2 : 0 ))
  echo "» hero: ${HERO_DUR}s a partir de ${inicio}s de memo/corredor-scrub.mp4"
  ffmpeg -nostdin -v error -y -ss "$inicio" -t "$HERO_DUR" -i "$HERO_FONTE" \
    "${SCRUB_ENC[@]}" "$hero"
else
  echo "» hero: já atualizado"
fi

# --- 4. Previews e posters ------------------------------------------------
com_preview=()
so_poster=()

for lp in "${LPS[@]}"; do
  screencast="$CAP/$lp.mp4"
  prev="$VID/prev-$lp.mp4"
  poster="$IMG/poster-$lp.jpg"

  if [[ -f "$screencast" ]]; then
    if precisa "$prev" "$screencast"; then
      echo "» preview: $lp"
      # 6s do começo da rolagem, cortado para 720x450 e sem áudio.
      ffmpeg -nostdin -v error -y -ss 1 -t 6 -i "$screencast" \
        -an -vf "scale=720:450:force_original_aspect_ratio=increase,crop=720:450" \
        -c:v libx264 -preset slow -crf 30 -maxrate 2200k -bufsize 4400k \
        -pix_fmt yuv420p -movflags +faststart "$prev"
    fi
    fonte_poster="$prev"
    com_preview+=("$lp")
  else
    echo "AVISO: sem screencast em capturas/src/$lp.mp4 — o card fica só com o poster."
    fonte_poster="$(scrub_de "$lp")"
    so_poster+=("$lp")
  fi

  if precisa "$poster" "$fonte_poster"; then
    ffmpeg -nostdin -v error -y -i "$fonte_poster" -frames:v 1 \
      -vf "scale=720:-2" -q:v 3 "$poster"
  fi
done

# --- 5. Resumo ------------------------------------------------------------
echo
echo "── resumo ──────────────────────────────────────────"
echo "LPs copiadas ....... ${#LPS[@]} (${LPS[*]})"
echo "previews ........... ${#com_preview[@]} (${com_preview[*]})"
if (( ${#so_poster[@]} )); then
  echo "só com poster ...... ${#so_poster[@]} (${so_poster[*]})"
fi
echo "hero ............... $(dur_de "$hero")s"
echo "tamanho de public/ . $(du -sh "$PUB" | cut -f1)"
echo "────────────────────────────────────────────────────"
