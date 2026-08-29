/* =====================================================================
 * QUANTOS QUADROS-CHAVE UMA TRANSMISSÃO NORMAL PRODUZ?
 * ---------------------------------------------------------------------
 * Quadro-chave é a imagem inteira, sem depender de nenhuma anterior. Ele
 * é MUITO maior que um quadro comum — uma rajada. Quando sai um, a fila
 * de envio entope por um instante e quem assiste vê uma travadinha.
 *
 * Numa transmissão saudável eles são raros: um no começo e olhe lá. Se
 * estiverem saindo o tempo todo, isso sozinho explica "fica caindo
 * constantemente".
 *
 * Três coisas podem pedir um quadro-chave:
 *   - o PRÓPRIO Frag, toda vez que muda o tamanho da imagem;
 *   - quem ASSISTE, quando perde pacote e não consegue mais decodificar
 *     (é o "PLI"/"FIR" — ele grita "manda tudo de novo");
 *   - o navegador, por conta dele.
 * Este medidor separa os três.
 * =================================================================== */
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const PASTA = 'C:/Users/BIGHOUSE/Downloads/frag-site';
const PORTA = 8101;
const BASE = 'http://localhost:' + PORTA + '/index.html';
const espera = (ms) => new Promise(r => setTimeout(r, ms));

const servidor = http.createServer((q, s) => {
  const n = decodeURIComponent(q.url.split('?')[0].split('#')[0]);
  fs.readFile(path.join(PASTA, n === '/' ? 'index.html' : n), (e, d) => {
    if (e) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); s.end(d);
  });
});

const TELA = () => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas');
    c.width = 1920; c.height = 1080;
    const g = c.getContext('2d');
    const s = c.captureStream(0);
    const f = s.getVideoTracks()[0];
    let t = 0;
    setInterval(() => {
      t++;
      for (let i = 0; i < 220; i++) {
        g.fillStyle = 'hsl(' + ((t * 7 + i * 13) % 360) + ',90%,' + (20 + (i % 60)) + '%)';
        g.fillRect((i * 137 + t * 23) % 1920, (i * 71 + t * 17) % 1080, 130, 130);
      }
      try { f.requestFrame(); } catch (e) {}
    }, 1000 / 60);
    return s;
  };
};

async function ate(f, p) {
  const fim = Date.now() + p;
  while (Date.now() < fim) { try { if (await f()) return true; } catch (e) {} await espera(600); }
  return false;
}

const FOTO = async () => {
  const p = [...pares.values()][0];
  const rel = await p.pc.getStats();
  let sv = null;
  rel.forEach(x => { if (x.type === 'outbound-rtp' && x.kind === 'video') sv = x; });
  if (!sv) return null;
  return {
    chaves: sv.keyFramesEncoded || 0,
    quadros: sv.framesEncoded || 0,
    pli: sv.pliCount || 0,
    fir: sv.firCount || 0,
    nack: sv.nackCount || 0,
    tamanho: sv.frameWidth + 'x' + sv.frameHeight,
    segura: sv.qualityLimitationReason || 'none',
    mexidas: window.__mexidas ? window.__mexidas.length : 0,
  };
};

async function principal() {
  await new Promise(r => servidor.listen(PORTA, r));
  const nav = await chromium.launch({ args: [
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required'] });
  const faz = async (larg) => {
    const c = await nav.newContext({ permissions: ['microphone'],
                                     viewport: { width: larg, height: Math.round(larg * 9 / 16) } });
    await c.addInitScript(TELA);
    return c.newPage();
  };
  const A = await faz(1600), B = await faz(1600);

  try {
    await A.goto(BASE, { waitUntil: 'load' });
    await A.fill('#meu-nome', 'Andre');
    await A.click('#btn-sala');
    if (!await ate(async () => (await A.inputValue('#sala-link')).includes('#e='), 40000))
      throw new Error('a sala não saiu');
    const link = await A.inputValue('#sala-link');
    await B.goto(link, { waitUntil: 'load' });
    await B.fill('#meu-nome', 'Bruno');
    await ate(async () => await A.evaluate(
      () => [...pares.values()].some(p => p.pc && p.pc.connectionState === 'connected')), 60000);

    /* grampo: contar toda mexida no compressor e na captura */
    await A.evaluate(() => {
      window.__mexidas = [];
      const ps = RTCRtpSender.prototype, orig = ps.setParameters;
      ps.setParameters = function (p) {
        try {
          const e = (p.encodings && p.encodings[0]) || {};
          window.__mexidas.push({ t: Date.now(), tipo: 'compressor',
            teto: e.maxBitrate || 0, escala: e.scaleResolutionDownBy || 1 });
        } catch (x) {}
        return orig.apply(this, arguments);
      };
      window.__constraints = 0;
      const pt = MediaStreamTrack.prototype, oc = pt.applyConstraints;
      pt.applyConstraints = function () { window.__constraints++; return oc.apply(this, arguments); };
    });

    await A.evaluate(() => { cfg.qualidade = '1080-60-8'; cfg.prioridade = 'fps'; });
    await A.click('#btn-tela');
    await ate(async () => await A.evaluate(FOTO).then(f => f && f.quadros > 0), 40000);
    await espera(5000);

    console.log('\n  medindo 90 segundos de transmissão…\n');
    console.log('   tempo  chaves  quadros   1 chave a cada   PLI  FIR   NACK  tamanho      mexidas');
    console.log('   ' + '-'.repeat(78));
    const t0 = Date.now();
    const base = await A.evaluate(FOTO);
    let ultimo = base;
    for (let i = 1; i <= 6; i++) {
      await espera(15000);
      const f = await A.evaluate(FOTO);
      const dChaves = f.chaves - base.chaves;
      const dQuadros = f.quadros - base.quadros;
      const cada = dChaves > 0 ? Math.round(dQuadros / dChaves) : 0;
      console.log('   ' + String(Math.round((Date.now() - t0) / 1000) + 's').padEnd(7) +
        String(dChaves).padStart(6) + String(dQuadros).padStart(9) +
        String(cada ? cada + ' quadros' : '—').padStart(17) +
        String(f.pli - base.pli).padStart(6) + String(f.fir - base.fir).padStart(5) +
        String(f.nack - base.nack).padStart(7) + '  ' + f.tamanho.padEnd(12) +
        String(f.mexidas).padStart(7));
      ultimo = f;
    }
    const cons = await A.evaluate(() => window.__constraints);
    const mex = await A.evaluate(() => window.__mexidas.map(x => ({ ...x })));

    const dCh = ultimo.chaves - base.chaves, dQ = ultimo.quadros - base.quadros;
    const segundos = Math.round((Date.now() - t0) / 1000);
    console.log('\n=== RESULTADO ===');
    console.log('  quadros-chave em ' + segundos + 's : ' + dCh +
                '  (1 a cada ' + (dCh ? Math.round(dQ / dCh) : '—') + ' quadros, ' +
                (dCh ? (segundos / dCh).toFixed(1) : '—') + 's entre eles)');
    console.log('  pedidos de quem assiste  : PLI ' + (ultimo.pli - base.pli) +
                ' | FIR ' + (ultimo.fir - base.fir) + ' | NACK ' + (ultimo.nack - base.nack));
    console.log('  mexidas no compressor    : ' + mex.length);
    console.log('  mexidas na captura       : ' + cons);
    if (mex.length) {
      console.log('  quando o compressor mexeu:');
      mex.forEach(x => console.log('    +' + String(Math.round((x.t - t0) / 1000)).padStart(3) + 's  teto ' +
        Math.round(x.teto / 1000) + ' kbps, escala ' + x.escala));
    }

    console.log('\n=== VEREDITO ===');
    const porMin = dCh / (segundos / 60);
    if (porMin > 12) console.log('  RUIM: ' + porMin.toFixed(1) + ' quadros-chave por minuto. Cada um é uma rajada — isso trava.');
    else if (porMin > 4) console.log('  SUSPEITO: ' + porMin.toFixed(1) + ' quadros-chave por minuto numa cena estável.');
    else console.log('  ok: ' + porMin.toFixed(1) + ' quadros-chave por minuto, dentro do esperado.');

  } catch (e) { console.log('explodiu: ' + ((e && e.message) || e)); }
  finally { await nav.close(); servidor.close(); process.exit(0); }
}
principal();
