/* =====================================================================
 * OS AJUSTES QUE COBRAM CARO
 * ---------------------------------------------------------------------
 * Dois ajustes do Frag fazem trabalho pesado por quadro e ficam
 * guardados no navegador — ou seja, podem estar ligados há semanas sem
 * ninguém lembrar:
 *
 *   cfg.desenho='canvas'  -> redesenha o vídeo INTEIRO na mão, 60x por
 *                            segundo, na linha principal da página
 *   cfg.clipeSempre=true  -> dois gravadores comprimindo sem parar
 *
 * Mesmo desenho de antes: liga, desliga, liga, desliga. Se o número
 * acompanhar o interruptor, é causa.
 * =================================================================== */
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const PASTA = 'C:/Users/BIGHOUSE/Downloads/frag-site';
const PORTA = 8099;
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

const LIGAR = () => {
  window.__m = { quadros: [], somaTravas: 0, travas: 0 };
  if (!window.__obs) {
    try {
      window.__obs = new PerformanceObserver(l => {
        for (const e of l.getEntries()) { window.__m.travas++; window.__m.somaTravas += e.duration; }
      });
      window.__obs.observe({ entryTypes: ['longtask'] });
    } catch (e) {}
  }
  if (!window.__raf) {
    window.__raf = true;
    let antes = 0;
    const passo = (agora) => {
      if (antes) { const dt = agora - antes; if (dt > 0 && dt < 1000) window.__m.quadros.push(dt); }
      antes = agora;
      requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }
};

const COLHER = () => {
  const q = window.__m.quadros;
  if (q.length < 20) return null;
  const ord = q.slice().sort((a, b) => a - b);
  const medio = q.reduce((a, b) => a + b, 0) / q.length;
  return {
    fps: +(1000 / medio).toFixed(1),
    p95: +(1000 / ord[Math.floor(ord.length * 0.95)]).toFixed(1),
    travas: window.__m.travas,
    msTravado: Math.round(window.__m.somaTravas),
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

    await A.evaluate(() => { cfg.qualidade = '1080-60-8'; cfg.prioridade = 'fps'; });
    await A.click('#btn-tela');
    await ate(async () => await B.evaluate(() => {
      const v = document.querySelector('#palco video'); return v && v.videoWidth > 0;
    }), 40000);
    await espera(10000);

    const CANVAS_ON  = () => { cfg.desenho = 'canvas'; aplicarModoDesenho(); };
    const CANVAS_OFF = () => { cfg.desenho = 'normal'; aplicarModoDesenho(); };

    const rodadas = [
      ['1. normal',       CANVAS_OFF],
      ['2. CANVAS',       CANVAS_ON],
      ['3. normal',       CANVAS_OFF],
      ['4. CANVAS',       CANVAS_ON],
    ];
    const res = [];
    console.log('\n  MODO DE DESENHO (cfg.desenho)');
    console.log('  rodada         quem          fps    5% pior   travas  tempo travado');
    console.log('  ' + '-'.repeat(68));
    for (const [nome, aplicar] of rodadas) {
      await A.evaluate(aplicar); await B.evaluate(aplicar);
      await espera(3000);
      await A.evaluate(LIGAR); await B.evaluate(LIGAR);
      await espera(22000);
      const a = await A.evaluate(COLHER), b = await B.evaluate(COLHER);
      res.push({ nome, a, b });
      const mostra = (quem, r) => console.log('  ' + nome.padEnd(15) + quem.padEnd(12) +
        String(r ? r.fps : '-').padStart(6) + String(r ? r.p95 : '-').padStart(10) +
        String(r ? r.travas : '-').padStart(9) + String(r ? r.msTravado + 'ms' : '-').padStart(11));
      mostra('TRANSMITE', a); mostra('ASSISTE', b);
    }
    await A.evaluate(CANVAS_OFF); await B.evaluate(CANVAS_OFF);

    console.log('\n=== VEREDITO — modo canvas ===');
    for (const lado of ['a', 'b']) {
      const nome = lado === 'a' ? 'quem TRANSMITE' : 'quem ASSISTE';
      const f = i => (res[i][lado] ? res[i][lado].fps : 0);
      const t = i => (res[i][lado] ? res[i][lado].msTravado : 0);
      const acompanha = f(1) < f(0) && f(3) < f(2);
      console.log('  ' + nome.padEnd(16) + 'fps normal ' +
        ((f(0) + f(2)) / 2).toFixed(1) + ' | canvas ' + ((f(1) + f(3)) / 2).toFixed(1) +
        '   travado normal ' + ((t(0) + t(2)) / 2).toFixed(0) + 'ms | canvas ' +
        ((t(1) + t(3)) / 2).toFixed(0) + 'ms');
      console.log('  ' + ''.padEnd(16) + (acompanha
        ? '-> ACOMPANHA O INTERRUPTOR: o modo canvas custa mesmo.'
        : '-> não acompanha o interruptor aqui.'));
    }
  } catch (e) { console.log('explodiu: ' + ((e && e.message) || e)); }
  finally { await nav.close(); servidor.close(); process.exit(0); }
}
principal();
