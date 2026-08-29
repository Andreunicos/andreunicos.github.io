/* Por que a prioridade da voz não pegou, e o que o navegador oferece
   mesmo para medir som x imagem. */
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const PASTA = 'C:/Users/BIGHOUSE/Downloads/frag-site';
const PORTA = 8103;
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
      for (let i = 0; i < 200; i++) {
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
    '--autoplay-policy=no-user-gesture-required'] });
  const faz = async () => {
    const c = await nav.newContext({ permissions: ['microphone'], viewport: { width: 1400, height: 800 } });
    await c.addInitScript(TELA); return c.newPage();
  };
  const A = await faz(), B = await faz();
  try {
    await A.goto(BASE, { waitUntil: 'load' });
    await A.fill('#meu-nome', 'Andre'); await A.click('#btn-sala');
    await ate(async () => (await A.inputValue('#sala-link')).includes('#e='), 40000);
    const link = await A.inputValue('#sala-link');
    await B.goto(link, { waitUntil: 'load' });
    await B.fill('#meu-nome', 'Bruno');
    await ate(async () => await A.evaluate(
      () => [...pares.values()].some(p => p.pc && p.pc.connectionState === 'connected')), 60000);
    await A.click('#btn-tela');
    await espera(10000);

    console.log('\n=== 1. setParameters na voz funciona? ===');
    const r = await A.evaluate(async () => {
      const p = [...pares.values()][0];
      const s = p.senderMic;
      if (!s) return { erro: 'sem senderMic' };
      const antes = JSON.parse(JSON.stringify(s.getParameters().encodings || []));
      let erro = null, depois = null;
      try {
        const par = s.getParameters();
        par.encodings = par.encodings && par.encodings.length ? par.encodings : [{}];
        par.encodings[0].networkPriority = 'high';
        par.encodings[0].priority = 'high';
        await s.setParameters(par);
        depois = JSON.parse(JSON.stringify(s.getParameters().encodings || []));
      } catch (e) { erro = String(e && e.message || e); }
      return { antes, depois, erro };
    });
    console.log('  encodings antes : ' + JSON.stringify(r.antes));
    console.log('  encodings depois: ' + JSON.stringify(r.depois));
    console.log('  erro            : ' + r.erro);

    console.log('\n=== 2. o que o navegador dá para medir som x imagem ===');
    const st = await B.evaluate(async () => {
      const p = [...pares.values()][0];
      const rel = await p.pc.getStats();
      const saida = { audio: null, video: null, tocando: [] };
      rel.forEach(x => {
        if (x.type === 'inbound-rtp' && x.kind === 'audio')
          saida.audio = { bytes: x.bytesReceived, playout: x.estimatedPlayoutTimestamp,
                          jbDelay: x.jitterBufferDelay, jbCount: x.jitterBufferEmittedCount };
        if (x.type === 'inbound-rtp' && x.kind === 'video')
          saida.video = { bytes: x.bytesReceived, playout: x.estimatedPlayoutTimestamp,
                          jbDelay: x.jitterBufferDelay, jbCount: x.jitterBufferEmittedCount };
        if (x.type === 'media-playout') saida.tocando.push(Object.keys(x));
      });
      return saida;
    });
    console.log('  inbound audio: ' + JSON.stringify(st.audio));
    console.log('  inbound video: ' + JSON.stringify(st.video));
    console.log('  media-playout: ' + JSON.stringify(st.tocando));

  } catch (e) { console.log('explodiu: ' + ((e && e.message) || e)); }
  finally { await nav.close(); servidor.close(); process.exit(0); }
}
principal();
