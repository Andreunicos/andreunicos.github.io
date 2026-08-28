/* =====================================================================
 * QUANTAS VEZES POR MINUTO O FRAG MEXE NO COMPRESSOR?
 * ---------------------------------------------------------------------
 * O próprio código diz, num comentário: "mexer no compressor custa um
 * soluço na imagem: se nada mudou, não mexe". A guarda existe — é a
 * comparação com a assinatura. A pergunta é se ela está funcionando, e
 * ninguém nunca mediu.
 *
 * A assinatura inclui o TETO. O teto sai de uma média que anda a cada
 * segundo. Se o teto for quem manda, a assinatura muda toda hora e a
 * guarda não guarda nada — seriam 60 solavancos por minuto.
 * =================================================================== */
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const PASTA = 'C:/Users/BIGHOUSE/Downloads/frag-site';
const PORTA = 8095;
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

async function principal() {
  await new Promise(r => servidor.listen(PORTA, r));
  const nav = await chromium.launch({ args: [
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required' ] });
  const faz = async (larg) => {
    const c = await nav.newContext({ permissions: ['microphone'],
                                     viewport: { width: larg, height: Math.round(larg * 9 / 16) } });
    await c.addInitScript(TELA);
    return c.newPage();
  };
  const A = await faz(1400), B = await faz(1920);

  try {
    await A.goto(BASE, { waitUntil: 'load' });
    await A.fill('#meu-nome', 'Andre');
    await A.click('#btn-sala');
    if (!await ate(async () => (await A.inputValue('#sala-link')).includes('#e='), 40000))
      throw new Error('sala não saiu');
    const link = await A.inputValue('#sala-link');
    await B.goto(link, { waitUntil: 'load' });
    await B.fill('#meu-nome', 'Bruno');
    await ate(async () => await A.evaluate(
      () => [...pares.values()].some(p => p.pc && p.pc.connectionState === 'connected')), 60000);

    /* grampo no setParameters: registra cada chamada e o que mudou */
    await A.evaluate(() => {
      window.__mexidas = [];
      const proto = RTCRtpSender.prototype;
      const orig = proto.setParameters;
      proto.setParameters = function (p) {
        try {
          const e = (p.encodings && p.encodings[0]) || {};
          window.__mexidas.push({
            t: Date.now(),
            teto: e.maxBitrate || 0,
            fps: e.maxFramerate || 0,
            escala: e.scaleResolutionDownBy || 1,
            degrada: p.degradationPreference || '',
            camadas: e.scalabilityMode || '',
          });
        } catch (err) {}
        return orig.apply(this, arguments);
      };
    });

    await A.evaluate(() => { cfg.qualidade = '1080-60-8'; cfg.prioridade = 'fps'; });
    await A.click('#btn-tela');
    await ate(async () => await A.evaluate(
      () => [...pares.values()][0].senderVideo != null), 30000);

    console.log('\ngravando 90 segundos de transmissão estável…\n');
    const t0 = Date.now();
    await A.evaluate(() => { window.__mexidas = []; });
    await espera(90000);

    const m = await A.evaluate(() => window.__mexidas.map(x => ({ ...x })));
    const segundos = Math.round((Date.now() - t0) / 1000);

    console.log('=== MEXIDAS NO COMPRESSOR ===');
    console.log('  ' + m.length + ' chamadas em ' + segundos + 's  =  ' +
                (m.length / segundos * 60).toFixed(1) + ' por minuto\n');

    /* o que exatamente mudou entre uma chamada e a seguinte? */
    const causas = {};
    for (let i = 1; i < m.length; i++) {
      const a = m[i - 1], b = m[i];
      const mudou = [];
      if (a.teto !== b.teto) mudou.push('teto');
      if (a.fps !== b.fps) mudou.push('fps');
      if (a.escala !== b.escala) mudou.push('tamanho');
      if (a.degrada !== b.degrada) mudou.push('degradacao');
      if (a.camadas !== b.camadas) mudou.push('camadas');
      const k = mudou.length ? mudou.join('+') : 'NADA';
      causas[k] = (causas[k] || 0) + 1;
    }
    console.log('  o que mudava a cada chamada:');
    Object.keys(causas).sort((x, y) => causas[y] - causas[x])
      .forEach(k => console.log('    ' + String(causas[k]).padStart(4) + 'x  ' + k));

    if (m.length > 4) {
      console.log('\n  as últimas 12 chamadas (teto em kbps):');
      m.slice(-12).forEach(x => console.log('    +' + String(Math.round((x.t - t0) / 1000)).padStart(3) +
        's  teto ' + String(Math.round(x.teto / 1000)).padStart(5) +
        '  fps ' + String(x.fps).padStart(3) + '  escala ' + x.escala));
    }

    const porMinuto = m.length / segundos * 60;
    console.log('\n=== VEREDITO ===');
    if (porMinuto > 20) console.log('  RUIM: o compressor está sendo remexido o tempo todo.');
    else if (porMinuto > 6) console.log('  SUSPEITO: mais mexidas do que uma transmissão estável justifica.');
    else console.log('  ok: a guarda da assinatura está segurando.');

  } catch (e) { console.log('explodiu: ' + ((e && e.message) || e)); }
  finally { await nav.close(); servidor.close(); process.exit(0); }
}
principal();
