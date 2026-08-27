/* =====================================================================
 * PROVA DO FRAG — dois navegadores conversando de verdade
 * ---------------------------------------------------------------------
 * Nada de fingimento: sobe o arquivo num servidor local, abre dois
 * navegadores separados, um cria a sala, o outro entra pelo link, e
 * então mede se a imagem CHEGOU — contando quadros decodificados e
 * olhando os pixels, não confiando em screenshot (que em headless não
 * captura <video> nenhum).
 *
 * A captura de tela é trocada por um canvas animado. Isso não é
 * trapaça: testa exatamente o mesmo caminho de replaceTrack, compressão,
 * envio, recebimento e desenho. O que ele NÃO mede é desempenho real —
 * headless não serve para dizer se o seu jogo perde FPS.
 * =================================================================== */
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const PASTA = 'C:/Users/BIGHOUSE/Downloads/frag-site';
const PORTA = 8099;
const BASE = 'http://localhost:' + PORTA + '/index.html';

const resultados = [];
const ok   = (t, extra) => { resultados.push(['ok', t, extra||'']);   console.log('  ok    ' + t + (extra?'  ('+extra+')':'')); };
const mal  = (t, extra) => { resultados.push(['mal', t, extra||'']);  console.log('  FALHA ' + t + (extra?'  ('+extra+')':'')); };
const info = (t) => console.log('        ' + t);
const titulo = (t) => console.log('\n=== ' + t + ' ===');

/* ---------- servidor local (https não precisa: localhost já é seguro) ---------- */
const servidor = http.createServer((req, res) => {
  const nome = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  const arq = path.join(PASTA, nome === '/' ? 'index.html' : nome);
  if (!arq.startsWith(PASTA.replace(/\//g, path.sep)) && !arq.startsWith(PASTA)) { res.writeHead(403); return res.end(); }
  fs.readFile(arq, (e, dados) => {
    if (e) { res.writeHead(404); return res.end('nao achei'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(dados);
  });
});

/* ---------- a tela falsa que vai ser transmitida ---------- */
const TELA_FALSA = () => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas');
    c.width = 1920; c.height = 1080;
    const g = c.getContext('2d');
    let t = 0;
    const desenhar = () => {
      t++;
      g.fillStyle = 'hsl(' + ((t * 3) % 360) + ',85%,55%)';
      g.fillRect(0, 0, 1920, 1080);
      g.fillStyle = '#ffffff';
      g.font = 'bold 220px sans-serif';
      g.fillText('FRAG ' + t, 120, 560);
      requestAnimationFrame(desenhar);
    };
    desenhar();
    const s = c.captureStream(60);
    try {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      osc.frequency.value = 220;
      const dst = ac.createMediaStreamDestination();
      osc.connect(dst); osc.start();
      dst.stream.getAudioTracks().forEach(tr => s.addTrack(tr));
    } catch (e) {}
    return s;
  };
};

const espera = (ms) => new Promise(r => setTimeout(r, ms));

async function ateQue(fn, prazo, passo) {
  const fim = Date.now() + prazo;
  while (Date.now() < fim) {
    try { if (await fn()) return true; } catch (e) {}
    await espera(passo || 500);
  }
  return false;
}

/* ---------- o que cada página sabe dizer sobre si mesma ---------- */
const ESTADO = () => {
  const gente = [...pares.values()].map(p => ({
    id: p.id, nome: p.nome,
    conexao: p.pc ? p.pc.connectionState : 'sem pc',
    canal: p.canal ? p.canal.readyState : 'nenhum',
    temTela: !!p.temTela,
    quadros: p.quadrosAntes || 0,
    temAuto: !!p.auto,
    fator: p.auto ? p.auto.fator : null,
  }));
  const quadros = [...document.querySelectorAll('#palco .quadro:not(.saindo)')].map(q => {
    const v = q.querySelector('video');
    return { id: q.id, largura: v ? v.videoWidth : 0, altura: v ? v.videoHeight : 0, pausado: v ? v.paused : null };
  });
  return {
    versao: VERSAO,
    naChamada: !document.getElementById('chamada').hidden,
    salaLigada: sala.ligada,
    gente, quadros,
    transmitindo: !!est.streamTela,
  };
};

/* ---------- olhar os pixels de verdade ---------- */
const PIXELS = (idQuadro) => {
  const q = document.getElementById(idQuadro);
  if (!q) return { erro: 'sem quadro' };
  const v = q.querySelector('video');
  if (!v || !v.videoWidth) return { erro: 'video sem tamanho' };
  const c = document.createElement('canvas');
  c.width = 48; c.height = 27;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(v, 0, 0, 48, 27);
  const d = g.getImageData(0, 0, 48, 27).data;
  let soma = 0, max = 0, coloridos = 0;
  for (let i = 0; i < d.length; i += 4) {
    const b = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    soma += b; if (b > max) max = b;
    if (Math.abs(d[i] - d[i + 1]) > 12 || Math.abs(d[i + 1] - d[i + 2]) > 12) coloridos++;
  }
  const n = d.length / 4;
  return { brilhoMedio: +(soma / n).toFixed(1), maisClaro: Math.round(max), coloridos, total: n,
           preta: max <= 8, largura: v.videoWidth, altura: v.videoHeight };
};

/* ===================================================================== */
async function principal() {
  await new Promise(r => servidor.listen(PORTA, r));
  console.log('servidor local em ' + BASE);

  const navegador = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-gpu-vsync',
    ],
  });

  const erros = { A: [], B: [] };
  const fazerPagina = async (rotulo) => {
    const ctx = await navegador.newContext({ permissions: ['microphone'], viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(TELA_FALSA);
    const pg = await ctx.newPage();
    pg.on('console', m => { if (m.type() === 'error') erros[rotulo].push(m.text().slice(0, 200)); });
    pg.on('pageerror', e => erros[rotulo].push('EXCECAO: ' + String(e.message).slice(0, 200)));
    return { ctx, pg };
  };

  const A = await fazerPagina('A');
  const B = await fazerPagina('B');

  try {
    /* ---------- 1. a página abre ---------- */
    titulo('1. A página abre e monta');
    await A.pg.goto(BASE, { waitUntil: 'load' });
    const versao = await A.pg.evaluate(() => VERSAO);
    versao.startsWith('3.3') ? ok('versão carregada', versao) : mal('versão errada', versao);
    const geometria = await A.pg.evaluate(() => {
      const e = document.getElementById('entrada').getBoundingClientRect();
      return { topo: Math.round(e.top), altura: Math.round(e.height), visivel: e.height > 100 };
    });
    geometria.visivel ? ok('tela de entrada desenhada', geometria.altura + 'px de altura')
                      : mal('tela de entrada fora do lugar', JSON.stringify(geometria));

    /* ---------- 2. criar a sala ---------- */
    titulo('2. Criar a sala');
    await A.pg.fill('#meu-nome', 'Andre');
    const t0 = Date.now();
    await A.pg.click('#btn-sala');
    const criou = await ateQue(async () => (await A.pg.inputValue('#sala-link')).includes('#e='), 40000);
    const demorou = ((Date.now() - t0) / 1000).toFixed(1);
    if (!criou) { mal('a sala não abriu em 40s'); throw new Error('sem sala'); }
    const link = await A.pg.inputValue('#sala-link');
    ok('sala criada', demorou + 's');
    info('link: ' + link.replace(/~.*/, '~<chave>'));
    if (Number(demorou) < 12) ok('abriu rápido (servidores em paralelo)', demorou + 's');
    else mal('demorou mais que o esperado', demorou + 's');

    /* ---------- 3. o amigo entra pelo link ---------- */
    titulo('3. O amigo entra pelo link');
    await B.pg.goto(link, { waitUntil: 'load' });
    await B.pg.fill('#meu-nome', 'Amigo');

    const conectou = await ateQue(async () => {
      const a = await A.pg.evaluate(ESTADO);
      const b = await B.pg.evaluate(ESTADO);
      return a.naChamada && b.naChamada &&
             a.gente.some(g => g.conexao === 'connected') &&
             b.gente.some(g => g.conexao === 'connected');
    }, 60000, 800);

    const eA = await A.pg.evaluate(ESTADO);
    const eB = await B.pg.evaluate(ESTADO);
    if (conectou) ok('os dois conectaram');
    else { mal('não conectaram em 60s'); info('A: ' + JSON.stringify(eA.gente)); info('B: ' + JSON.stringify(eB.gente)); }
    const canaisAbertos = eA.gente.every(g => g.canal === 'open') && eB.gente.every(g => g.canal === 'open');
    canaisAbertos ? ok('canal de dados aberto dos dois lados') : mal('canal de dados não abriu');

    /* ---------- 4. áudio: o som do jogo também em estéreo ---------- */
    titulo('4. Áudio — a correção do fmtp');
    const sdp = await A.pg.evaluate(() => {
      const p = [...pares.values()][0];
      return p && p.pc && p.pc.localDescription ? p.pc.localDescription.sdp : '';
    });
    const secoesOpus = (sdp.match(/a=rtpmap:\d+ opus\/48000\/2/gi) || []).length;
    const comEstereo = (sdp.match(/a=fmtp:\d+ [^\r\n]*stereo=1/gi) || []).length;
    info('seções de áudio no SDP: ' + secoesOpus + ' | com estéreo 128k: ' + comEstereo);
    if (secoesOpus >= 2 && comEstereo >= 2) ok('TODAS as faixas de áudio em 128 kbps estéreo', comEstereo + ' de ' + secoesOpus);
    else if (comEstereo === 1) mal('só a primeira faixa foi corrigida (o bug antigo)', comEstereo + ' de ' + secoesOpus);
    else mal('estéreo não aplicado', comEstereo + ' de ' + secoesOpus);

    /* ---------- 5. transmitir a tela ---------- */
    titulo('5. Transmitir a tela');
    await A.pg.click('#btn-tela');
    const transmitindo = await ateQue(async () => (await A.pg.evaluate(ESTADO)).transmitindo, 15000);
    transmitindo ? ok('captura iniciada em A') : mal('captura não iniciou');

    const chegou = await ateQue(async () => {
      const b = await B.pg.evaluate(ESTADO);
      return b.gente.some(g => g.quadros > 10) && b.quadros.some(q => q.largura > 0);
    }, 40000, 800);

    const eB2 = await B.pg.evaluate(ESTADO);
    if (chegou) {
      const g = eB2.gente[0];
      ok('a imagem chegou no amigo', g.quadros + ' quadros decodificados');
      const q = eB2.quadros.find(x => x.largura > 0);
      ok('quadro desenhado', q.largura + 'x' + q.altura + (q.pausado ? ' PAUSADO' : ' tocando'));
    } else {
      mal('nenhum quadro chegou em 40s');
      info('B: ' + JSON.stringify(eB2));
    }

    /* ---------- 6. os pixels (a lição do CLAUDE.md) ---------- */
    titulo('6. Os pixels de verdade');
    const idQ = eB2.quadros.length ? eB2.quadros[0].id : null;
    if (idQ) {
      const px = await B.pg.evaluate(PIXELS, idQ);
      if (px.erro) mal('não consegui olhar os pixels', px.erro);
      else if (px.preta) mal('IMAGEM TOTALMENTE PRETA', JSON.stringify(px));
      else {
        ok('imagem com conteúdo', 'brilho médio ' + px.brilhoMedio + '/255, mais claro ' + px.maisClaro);
        px.coloridos > px.total * 0.3
          ? ok('a cor animada chegou inteira', px.coloridos + ' de ' + px.total + ' pixels coloridos')
          : mal('imagem sem cor — pode ser quadro parado', px.coloridos + ' de ' + px.total);
      }
    } else mal('sem quadro para olhar');

    /* ---------- 7. as mudanças da 3.3 ---------- */
    titulo('7. O que mudou na 3.3');
    const conf = await A.pg.evaluate(() => {
      const p = [...pares.values()][0];
      const par = p && p.senderVideo ? p.senderVideo.getParameters() : null;
      return {
        temAutoPorPessoa: !!(p && p.auto),
        degradacao: par ? par.degradationPreference : null,
        fps: par && par.encodings && par.encodings[0] ? par.encodings[0].maxFramerate : null,
        teto: par && par.encodings && par.encodings[0] ? par.encodings[0].maxBitrate : null,
        turnVazio: TURN_PADRAO.length === 0,
        temMarcarFala: typeof marcarFala === 'function',
        temAmplificador: typeof ligarAmplificador === 'function',
        temAv1: !!document.querySelector('#sel-codec option[value="av1"]'),
      };
    });
    conf.temAutoPorPessoa ? ok('cada pessoa tem a própria régua de qualidade') : mal('régua por pessoa não criada');
    conf.degradacao === 'maintain-framerate'
      ? ok('prioridade = segurar os quadros', conf.degradacao)
      : mal('degradationPreference errado', String(conf.degradacao));
    ok('teto pedido ao compressor', Math.round((conf.teto || 0) / 1000) + ' kbps a ' + conf.fps + ' fps');
    conf.turnVazio ? ok('lista de retransmissor vazia (sem endereço morto)') : mal('ainda tem TURN morto na lista');
    conf.temMarcarFala ? ok('marcarFala existe') : mal('marcarFala sumiu');
    conf.temAv1 ? ok('AV1 no menu') : mal('AV1 fora do menu');

    /* ---------- 8. volume acima de 100% ---------- */
    titulo('8. Volume acima de 100%');
    const vol = await B.pg.evaluate(() => {
      const p = [...pares.values()][0];
      if (!p) return { erro: 'sem par' };
      p.volume = 200;
      aplicarVolume();
      return { ganho: p.ganho ? p.ganho.gain.value : null, volumeDoElemento: p.audio ? p.audio.volume : null };
    });
    if (vol.erro) mal('não deu pra testar', vol.erro);
    else if (vol.ganho && vol.ganho > 1.5) ok('amplificador funcionando', 'ganho ' + vol.ganho.toFixed(2) + 'x');
    else mal('amplificador não engatou', JSON.stringify(vol));

    /* ---------- 9. servidor entupido sai da roda ---------- */
    titulo('9. Quando o servidor de recado recusa');
    const roda = await A.pg.evaluate(() => ({
      todos: SINAIS, usando: sala.bases, recusas: sala.cheios,
      mudo: sala.mudo, avisou: sala.avisouCheio,
    }));
    info('lista: ' + roda.todos.join(', '));
    info('em uso: ' + roda.usando.join(', '));
    info('recusas: ' + JSON.stringify(roda.recusas));
    roda.todos.length === 3 ? ok('servidor morto fora da lista', '3 servidores') : mal('lista errada');
    if (Object.values(roda.recusas).some(n => n >= 3)) {
      roda.usando.length < roda.todos.length
        ? ok('servidor entupido saiu da roda', roda.usando.length + ' de ' + roda.todos.length + ' em uso')
        : mal('servidor entupido continua na roda');
    } else info('(nenhum servidor recusou 3x seguidas nesta rodada — nada a tirar)');
    roda.avisou ? info('o aviso de "quadro entupido" chegou a aparecer') : ok('mensagem passou por algum servidor');

    /* ---------- 10. erros no console ---------- */
    titulo('10. Erros no console');
    const todos = [...erros.A.map(e => 'A: ' + e), ...erros.B.map(e => 'B: ' + e)];
    const graves = todos.filter(e => /EXCECAO|is not defined|is not a function|Cannot read/i.test(e));
    graves.length ? mal(graves.length + ' erro(s) grave(s)') : ok('nenhuma exceção de JavaScript');
    todos.slice(0, 12).forEach(e => info(e));

  } catch (e) {
    mal('o teste explodiu', String(e && e.message || e));
  } finally {
    titulo('RESUMO');
    const bons = resultados.filter(r => r[0] === 'ok').length;
    const ruins = resultados.filter(r => r[0] === 'mal');
    console.log('  ' + bons + ' passaram, ' + ruins.length + ' falharam');
    ruins.forEach(r => console.log('    FALHOU: ' + r[1] + (r[2] ? '  (' + r[2] + ')' : '')));
    await navegador.close();
    servidor.close();
    process.exit(ruins.length ? 1 : 0);
  }
}

principal();
