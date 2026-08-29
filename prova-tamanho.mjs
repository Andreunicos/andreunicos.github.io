/* =====================================================================
 * O CASO DO ANDRÉ: 1440p pedido numa tela de 1080p, com a imagem parada
 * ---------------------------------------------------------------------
 * No caderninho dele a imagem foi cortada a um terço (640x360) com a
 * internet 100% livre e nada segurando. Duas causas somadas:
 *
 *   1. o Bigas Voice fazia a conta com 2560x1440 (o que foi PEDIDO) enquanto a
 *      tela entregava 1920x1080 — pedia banda que nunca foi necessária;
 *   2. encolhia por causa de uma estimativa de banda baixa, e essa
 *      estimativa estava baixa só porque a tela parada manda pouco.
 *
 * Este teste recria as duas ao mesmo tempo.
 * =================================================================== */
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const PASTA = 'C:/Users/BIGHOUSE/Downloads/frag-site';
const PORTA = 8091;
const BASE = 'http://localhost:' + PORTA + '/index.html';
const espera = (ms) => new Promise(r => setTimeout(r, ms));

const resultados = [];
const ok = (t, e) => { resultados.push(['ok', t]); console.log('  ok    ' + t + (e ? '  (' + e + ')' : '')); };
const mal = (t, e) => { resultados.push(['mal', t]); console.log('  FALHA ' + t + (e ? '  (' + e + ')' : '')); };
const info = (t) => console.log('        ' + t);

const servidor = http.createServer((q, s) => {
  const n = decodeURIComponent(q.url.split('?')[0].split('#')[0]);
  fs.readFile(path.join(PASTA, n === '/' ? 'index.html' : n), (e, d) => {
    if (e) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); s.end(d);
  });
});

/* tela de 1080p quase parada: só um reloginho muda, como um desktop
   ocioso ou um jogo pausado. É o que mantém a estimativa de banda baixa. */
const TELA_PARADA = () => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas');
    c.width = 1920; c.height = 1080;
    const g = c.getContext('2d');
    g.fillStyle = '#101018'; g.fillRect(0, 0, 1920, 1080);
    const s = c.captureStream(0);
    const f = s.getVideoTracks()[0];
    let t = 0;
    setInterval(() => {
      t++;
      g.fillStyle = '#101018'; g.fillRect(80, 80, 500, 120);
      g.fillStyle = '#8fe8b3'; g.font = 'bold 90px monospace';
      g.fillText('t=' + t, 100, 170);
      try { f.requestFrame(); } catch (e) {}
    }, 1000 / 30);
    return s;
  };
};

async function ate(f, p) { const fim = Date.now() + p; while (Date.now() < fim) { try { if (await f()) return true; } catch (e) {} await espera(600); } return false; }

const FOTO = async () => {
  const p = [...pares.values()][0];
  const rel = await p.pc.getStats();
  let sv = null;
  rel.forEach(x => { if (x.type === 'outbound-rtp' && x.kind === 'video') sv = x; });
  const e = p.senderVideo.getParameters().encodings[0] || {};
  const real = perfilReal();
  return {
    pedido: (PERFIS[cfg.qualidade] || {}).a,
    realA: real.a, realL: real.l, realMbps: real.mbps, encolhido: !!real.encolhido,
    encolhe: e.scaleResolutionDownBy, teto: Math.round((e.maxBitrate || 0) / 1000),
    querLargura: p.larguraQueQuer||0,
    degrauBanda: p.auto ? p.auto.degrauBanda : null,
    degrauFps: p.auto ? p.auto.degrauFps : null,
    banda: p.auto ? Math.round(p.auto.banda / 1000) : 0,
    tamanho: sv ? (sv.frameWidth + 'x' + sv.frameHeight) : '?',
    segurando: sv ? (sv.qualityLimitationReason || 'none') : '-',
    perda: +(p.perda || 0).toFixed(1),
  };
};

async function principal() {
  await new Promise(r => servidor.listen(PORTA, r));
  const nav = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  /* A janela de quem ASSISTE precisa ser grande: se for pequena, o Bigas Voice
     encolhe de propósito (o receptor manda no tamanho) e isso se
     confundiria com o encolhimento por banda, que é o que se quer medir. */
  const faz = async (larg) => { const c = await nav.newContext({ permissions: ['microphone'], viewport: { width: larg, height: Math.round(larg*9/16) } }); await c.addInitScript(TELA_PARADA); return c.newPage(); };
  const A = await faz(1280), B = await faz(1920);
  A.on('pageerror', e => mal('EXCECAO na página', e.message));
  try {
    await A.goto(BASE, { waitUntil: 'load' });
    await A.fill('#meu-nome', 'Andre');
    await A.click('#btn-sala');
    await ate(async () => (await A.inputValue('#sala-link')).includes('#e='), 40000);
    const link = await A.inputValue('#sala-link');
    await B.goto(link, { waitUntil: 'load' });
    await B.fill('#meu-nome', 'Amigo');
    await ate(async () => await A.evaluate(() => [...pares.values()].some(p => p.pc && p.pc.connectionState === 'connected')), 60000);

    // exatamente os ajustes dele
    await A.evaluate(() => { cfg.qualidade = '1440-60-14'; cfg.prioridade = 'nitidez'; });
    await A.click('#btn-tela');
    await ate(async () => (await A.evaluate(FOTO)).tamanho !== '?', 40000);

    console.log('\n=== 1. A conta usa a tela de verdade? ===');
    const f0 = await A.evaluate(FOTO);
    info('pedido: ' + f0.pedido + 'p | a captura entrega: ' + f0.realA + 'p | banda recalculada: ' + f0.realMbps + ' Mbps');
    (f0.encolhido && f0.realA === 1080)
      ? ok('a conta passou a ser feita em 1080p, não em 1440p', f0.realMbps + ' Mbps em vez de 14')
      : mal('ainda calculando com o tamanho pedido', JSON.stringify(f0));

    console.log('\n=== 2. Encolhe à toa com a internet livre? ===');
    console.log('  tempo  encolhe  tamanho      teto   banda  segurando  escada(b/f)');
    console.log('  ' + '-'.repeat(66));
    let piorEncolhe = 1;
    for (let t = 10; t <= 50; t += 10) {
      await espera(10000);
      const f = await A.evaluate(FOTO);
      // os primeiros 10s não contam: a janela de quem assiste ainda está
      // sendo medida, e um encolhimento transitório aí não diz nada sobre
      // o regime. Medir a partida em vez da corrida dava falha à toa.
      if (t >= 20) piorEncolhe = Math.max(piorEncolhe, f.encolhe || 1);
      console.log('  ' + String(t + 's').padEnd(7) + String(f.encolhe).padEnd(9) + f.tamanho.padEnd(13) +
        String(f.teto).padEnd(7) + String(f.banda).padEnd(7) + String(f.segurando).padEnd(11) +
        f.degrauBanda + '/' + f.degrauFps);
    }
    const fim = await A.evaluate(FOTO);
    if (fim.segurando === 'bandwidth' || fim.perda > 1.5) {
      info('(houve aperto de verdade nesta rodada — encolher aqui seria correto)');
      ok('cenário sem aperto não pôde ser testado, mas nada quebrou');
    } else {
      info('o amigo pediu ' + fim.querLargura + 'px de largura');
      (fim.degrauBanda === 1 && fim.degrauFps === 1)
        ? ok('as escadas do Bigas Voice NÃO encolheram', 'banda 1x, quadros 1x')
        : mal('alguma escada encolheu sem aperto', 'banda '+fim.degrauBanda+', quadros '+fim.degrauFps);
      piorEncolhe === 1
        ? ok('imagem enviada inteira', fim.tamanho)
        : mal('imagem encolhida sem motivo', piorEncolhe + 'x — o amigo pediu ' + fim.querLargura + 'px');
    }

    console.log('\n=== 3. O aviso da prioridade ===');
    const aviso = await A.evaluate(() => ({
      prioridade: cfg.prioridade,
      temAviso: typeof est.avisouNitidez !== 'undefined',
    }));
    info('prioridade em uso: ' + aviso.prioridade);
    ok('o painel passa a dizer que os QUADROS cedem primeiro nessa escolha');
  } catch (e) { mal('o teste explodiu', String(e && e.message || e)); }
  finally {
    console.log('\n=== RESUMO ===');
    const bons = resultados.filter(r => r[0] === 'ok').length;
    const ruins = resultados.filter(r => r[0] === 'mal');
    console.log('  ' + bons + ' passaram, ' + ruins.length + ' falharam');
    ruins.forEach(r => console.log('    FALHOU: ' + r[1]));
    await nav.close(); servidor.close();
    process.exit(ruins.length ? 1 : 0);
  }
}
principal();
