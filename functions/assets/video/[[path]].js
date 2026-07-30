// Rota /assets/video/* (o vídeo do hero). A lógica está em _lib/range.js,
// compartilhada com a rota das LPs.
import { serveWithRange } from '../../_lib/range.js';

export const onRequest = serveWithRange;
