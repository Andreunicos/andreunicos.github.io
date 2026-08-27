/* =====================================================================
 * A ESCADA DOS QUADROS FUNCIONA?
 * ---------------------------------------------------------------------
 * Aperta a banda dentro do próprio Frag (mexendo no perfil escolhido) e
 * acompanha a trajetória: o Frag encolhe a imagem sozinho até os quadros
 * voltarem para o alvo, ou fica pequeno E travado como antes?
 * =================================================================== */
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const PASTA = 'C:/Users/BIGHOUSE/Downloads/frag-site';
const PORTA = 8095;
const BASE = 'http://localhost:' + PORTA + '/index.html';
const espera = (ms) => new Promise(r => setTimeout(r, ms));

const servidor = http.createServer((req, res) => {
  const nome = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  fs.readFile(path.join(PASTA, nome === '/' ? 'index.html' : nome), (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(d);
  });
});

const TELA_FALSA = () => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas');
    c.width = 1920; c.height = 1080;
    const g = c.getContext('2d');
    const s = c.captureStream(0);
    const faixa = s.getVideoTracks()[0];
    let t = 0;
    setInterval(() => {
      t++;
      for (let y = 0; y < 1080; y += 40)
        for (let x = 0; x < 1920; x += 40) {
          g.fillStyle = 'hsl(' + ((x * 7 + y * 13 + t * 29) % 360) + ',95%,' + (25 + ((x + y + t * 17) % 55)) + '%)';
          g.fillRect(x, y, 40, 40);
        }
      try { faixa.requestFrame(); } catch (e) {}
    }, 1000 / 60);
    return s;
  };
};

async function ateQue(fn, prazo, passo) {
  const fim = Date.now() + prazo;
  while (Date.now() < fim) { try { if (await fn()) return true; } catch (e) {} await espera(passo || 600); }
  return false;
}

const FOTO = async () => {
  const p = [...pares.values()][0];
  const rel = await p.pc.getStats();
  let saida = null, fonte = null;
  rel.forEach(x => {
    if (x.type === 'outbound-rtp' && x.kind === 'video') saida = x;
    if (x.type === 'media-source' && x.kind === 'video') fonte = x;
  });
  const e = p.senderVideo.getParameters().encodings[0] || {};
  return {
    entrega: fonte ? Math.round(fonte.framesPerSecond || 0) : 0,
    fps: saida ? Math.round(saida.framesPerSecond || 0) : 0,
    encodados: saida ? (saida.framesEncoded || 0) : 0,
    tamanho: saida ? (saida.frameWidth + 'x' + saida.frameHeight) : '?',
    segurando: saida ? (saida.qualityLimitationReason || '-') : '-',
    camadas: e.scalabilityMode, encolhe: e.scaleResolutionDownBy,
    degrauBanda: p.auto ? p.auto.degrauBanda : null,
    degrauFps: p.auto ? p.auto.degrauFps : null,
    motivo: p.auto ? p.auto.motivo : '',
  };
};

async function principal() {
  await new Promise(r => servidor.listen(PORTA, r));
  const nav = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
           '--autoplay-policy=no-user-gesture-required', '--disable-gpu-vsync'],
  });
  const fazer = async () => {
    const ctx = await nav.newContext({ permissions: ['microphone'], viewport: { width: 1920, height: 1080 } });
    await ctx.addInitScript(TELA_FALSA);
    return ctx.newPage();
  };
  const A = await fazer(), B = await fazer();
  try {
    await A.goto(BASE, { waitUntil: 'load' });
    await A.fill('#meu-nome', 'A');
    await A.click('#btn-sala');
    await ateQue(async () => (await A.inputValue('#sala-link')).includes('#e='), 40000);
    const link = await A.inputValue('#sala-link');
    await B.goto(link, { waitUntil: 'load' });
    await B.fill('#meu-nome', 'B');
    await ateQue(async () => await A.evaluate(() => [...pares.values()].some(p => p.pc && p.pc.connectionState === 'connected')), 60000);

    // aperta: o Frag passa a mirar 1,2 Mbps para 1080p60 de conteúdo pesado
    await A.evaluate(() => { PERFIS['1080-60-8'].mbps = 1.2; });
    await A.click('#btn-tela');
    await ateQue(async () => (await A.evaluate(FOTO)).encodados > 20, 40000);

    console.log('\n  tempo   quadros  tamanho      escada(banda/fps)  segurando por   camadas');
    console.log('  ' + '-'.repeat(78));
    let melhorFps = 0;
    for (let t = 5; t <= 60; t += 5) {
      await espera(5000);
      const f = await A.evaluate(FOTO);
      melhorFps = Math.max(melhorFps, f.fps);
      console.log('  ' + String(t + 's').padEnd(8) + String(f.fps).padEnd(9) + f.tamanho.padEnd(13) +
        (String(f.degrauBanda) + ' / ' + String(f.degrauFps)).padEnd(19) +
        String(f.segurando).padEnd(16) + f.camadas);
    }
    const fim = await A.evaluate(FOTO);
    console.log('\n  a tela entregava: ' + fim.entrega + ' fps');
    console.log('  melhor momento depois de apertar: ' + melhorFps + ' fps');
    console.log('  motivo mostrado no painel: "' + (fim.motivo || '(nenhum)') + '"');
    console.log('\n  ' + (fim.fps >= 45
      ? 'A escada dos quadros segurou: encolheu a imagem e devolveu a fluidez.'
      : 'Ainda travado — encolher não bastou neste cenário.'));
  } catch (e) {
    console.log('EXPLODIU: ' + (e && e.message || e));
  } finally { await nav.close(); servidor.close(); }
}
principal();
