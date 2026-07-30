// Rota /lps/<lp>/media/* (os vídeos de scrub das LPs). A lógica está em
// _lib/range.js, compartilhada com a rota do hero.
import { serveWithRange } from '../../../_lib/range.js';

export const onRequest = serveWithRange;
