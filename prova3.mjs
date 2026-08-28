/* =====================================================================
 * PROVA DO FRAG COM TRÊS PESSOAS
 * ---------------------------------------------------------------------
 * Com dois é fácil. O que quebra de verdade é o terceiro: é aí que a
 * malha vira malha (cada um com dois vizinhos), que a banda tem que ser
 * dividida, e que existe um amigo em comum capaz de servir de carteiro.
 * =================================================================== */
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const PASTA = 'C:/Users/BIGHOUSE/Downloads/frag-site';
const PORTA = 8098;
const BASE = 'http://localhost:' + PORTA + '/index.html';

const resultados = [];
const ok = (t, e) => { resultados.push(['ok', t, e || '']); console.log('  ok    ' + t + (e ? '  (' + e + ')' : '')); };
const mal = (t, e) => { resultados.push(['mal', t, e || '']); console.log('  FALHA ' + t + (e ? '  (' + e + ')' : '')); };
const info = (t) => console.log('        ' + t);
const titulo = (t) => console.log('\n=== ' + t + ' ===');
const espera = (ms) => new Promise(r => setTimeout(r, ms));

async function ateQue(fn, prazo, passo) {
  const fim = Date.now() + prazo;
  while (Date.now() < fim) { try { if (await fn()) return true; } catch (e) {} await espera(passo || 600); }
  return false;
}

const servidor = http.createServer((req, res) => {
  const nome = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  fs.readFile(path.join(PASTA, nome === '/' ? 'index.html' : nome), (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(d);
  });
});

const TELA_FALSA = () => {
  window.__posts = 0;
  const f = window.fetch;
  window.fetch = function (u, o) {
    try { if (String(u).includes('ntfy') && o && o.method === 'POST') window.__posts++; } catch (e) {}
    return f.apply(this, arguments);
  };
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas');
    c.width = 1920; c.height = 1080;
    const g = c.getContext('2d');
    let t = 0;
    const d = () => { t++; g.fillStyle = 'hsl(' + ((t * 3) % 360) + ',85%,55%)'; g.fillRect(0, 0, 1920, 1080); requestAnimationFrame(d); };
    d();
    return c.captureStream(60);
  };
};

/* espiões: contam quantas vezes a ponte foi usada de verdade */
const ESPIAO = () => {
  window.__viaPonte = 0; window.__pontes = 0;
  const om = window.mandarSinal;
  window.mandarSinal = async function () {
    const r = await om.apply(this, arguments);
    if (r === 'ponte') window.__viaPonte++;
    return r;
  };
  const op = window.aoPonte;
  window.aoPonte = function () { window.__pontes++; return op.apply(this, arguments); };
};

const ESTADO = () => ({
  naChamada: !document.getElementById('chamada').hidden,
  eu: eu.id,
  gente: [...pares.values()].map(p => ({
    id: p.id, nome: p.nome, conexao: p.pc ? p.pc.connectionState : '-',
    canal: p.canal ? p.canal.readyState : '-', quadros: p.quadrosAntes || 0,
    conhece: p.conhece ? [...p.conhece] : null,
  })),
  posts: window.__posts, viaPonte: window.__viaPonte, pontes: window.__pontes,
});

async function principal() {
  await new Promise(r => servidor.listen(PORTA, r));
  const nav = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
           '--autoplay-policy=no-user-gesture-required', '--disable-gpu-vsync'],
  });
  const erros = [];
  const fazer = async (rotulo) => {
    const ctx = await nav.newContext({ permissions: ['microphone'], viewport: { width: 1100, height: 700 } });
    await ctx.addInitScript(TELA_FALSA);
    const pg = await ctx.newPage();
    pg.on('pageerror', e => erros.push(rotulo + ' EXCECAO: ' + String(e.message).slice(0, 160)));
    pg.on('console', m => { if (m.type() === 'error' && !/429|Failed to load resource/.test(m.text())) erros.push(rotulo + ': ' + m.text().slice(0, 160)); });
    return pg;
  };

  const A = await fazer('A'), B = await fazer('B'), C = await fazer('C');

  try {
    titulo('1. A cria a sala, B entra');
    await A.goto(BASE, { waitUntil: 'load' });
    await A.fill('#meu-nome', 'Andre');
    await A.click('#btn-sala');
    if (!await ateQue(async () => (await A.inputValue('#sala-link')).includes('#e='), 40000)) { mal('sala não abriu'); throw new Error('sem sala'); }
    const link = await A.inputValue('#sala-link');
    ok('sala criada');

    await B.goto(link, { waitUntil: 'load' });
    await B.fill('#meu-nome', 'Bruno');
    const dois = await ateQue(async () => {
      const a = await A.evaluate(ESTADO), b = await B.evaluate(ESTADO);
      return a.gente.some(g => g.conexao === 'connected') && b.gente.some(g => g.conexao === 'connected');
    }, 60000);
    dois ? ok('A e B conectados') : mal('A e B não conectaram');

    /* os espiões entram DEPOIS de A e B, para medir só o que o C custou */
    await A.evaluate(ESPIAO); await B.evaluate(ESPIAO);
    const postsAntes = (await A.evaluate(ESTADO)).posts + (await B.evaluate(ESTADO)).posts;

    titulo('2. O terceiro chega');
    await C.goto(link, { waitUntil: 'load' });
    await C.fill('#meu-nome', 'Carla');
    await C.evaluate(ESPIAO);

    const tres = await ateQue(async () => {
      const [a, b, c] = [await A.evaluate(ESTADO), await B.evaluate(ESTADO), await C.evaluate(ESTADO)];
      return [a, b, c].every(x => x.gente.filter(g => g.conexao === 'connected').length === 2);
    }, 90000, 900);

    const [eA, eB, eC] = [await A.evaluate(ESTADO), await B.evaluate(ESTADO), await C.evaluate(ESTADO)];
    if (tres) ok('os três conectados, cada um com dois vizinhos');
    else {
      mal('a malha de três não fechou');
      [eA, eB, eC].forEach((x, i) => info('ABC'[i] + ': ' + JSON.stringify(x.gente.map(g => g.nome + '=' + g.conexao))));
    }
    const canais = [eA, eB, eC].every(x => x.gente.every(g => g.canal === 'open'));
    canais ? ok('todos os canais de dados abertos') : mal('algum canal de dados não abriu');

    titulo('3. O carteiro (a ponte pela malha)');
    info('A conhece: ' + JSON.stringify(eA.gente.map(g => g.nome)));
    const sabemQuemEhQuem = [eA, eB, eC].some(x => x.gente.some(g => g.conhece && g.conhece.length > 0));
    sabemQuemEhQuem ? ok('os vizinhos se anunciam uns aos outros') : mal('ninguém anunciou quem alcança');

    const usos = eA.viaPonte + eB.viaPonte + eC.viaPonte;
    const entregas = eA.pontes + eB.pontes + eC.pontes;
    info('recados enviados pela ponte: ' + usos + ' | recados que passaram por um carteiro: ' + entregas);
    if (usos > 0 || entregas > 0) ok('a ponte foi usada de verdade', usos + ' envios, ' + entregas + ' entregas');
    else info('(nesta rodada todos se acharam direto antes de precisar de carteiro — a ponte é rede de segurança, não caminho obrigatório)');

    titulo('4. O terceiro custou quanto de servidor?');
    const postsDepois = eA.posts + eB.posts + eC.posts;
    info('pedidos ao servidor: ' + postsAntes + ' antes do C, ' + postsDepois + ' com o C dentro');
    (postsDepois - postsAntes) < 45
      ? ok('o terceiro entrou barato', (postsDepois - postsAntes) + ' pedidos')
      : mal('o terceiro custou caro demais', (postsDepois - postsAntes) + ' pedidos');

    titulo('5. A transmite, os outros dois assistem');
    await A.click('#btn-tela');
    const viram = await ateQue(async () => {
      const b = await B.evaluate(ESTADO), c = await C.evaluate(ESTADO);
      return b.gente.some(g => g.quadros > 10) && c.gente.some(g => g.quadros > 10);
    }, 50000, 900);
    if (viram) {
      const b = await B.evaluate(ESTADO), c = await C.evaluate(ESTADO);
      ok('os dois receberam imagem',
        'B ' + Math.max(...b.gente.map(g => g.quadros)) + ' quadros, C ' + Math.max(...c.gente.map(g => g.quadros)) + ' quadros');
    } else mal('a imagem não chegou nos dois');

    const banda = await A.evaluate(() => [...pares.values()].map(p => {
      const e = p.senderVideo && p.senderVideo.getParameters().encodings[0];
      return { nome: p.nome, teto: e ? e.maxBitrate : 0, encolhe: e ? e.scaleResolutionDownBy : 0,
               porque: p.porqueTamanho || "?", escB: p.auto ? p.auto.degrauBanda : 0, quer: p.larguraQueQuer||0 };
    }));
    info('por pessoa: ' + JSON.stringify(banda));
    banda.length === 2 && banda.every(x => x.teto > 0 && x.teto <= 4100000)
      ? ok('a banda foi dividida entre os dois', Math.round(banda[0].teto / 1000) + ' kbps para cada')
      : mal('a divisão de banda saiu errada', JSON.stringify(banda));

    titulo('6. A banda não é dividida duas vezes');
    /* O /n do orçamento total está certo (o upload é um só). Mas a banda
       MEDIDA é por conexão e as conexões já competem entre si — ela já vem
       repartida. Dividir de novo dava um terço da qualidade numa call de 3. */
    const divisao = await A.evaluate(async () => {
      const gente = [...pares.values()].filter(p => p.senderVideo);
      const p = gente[0];
      const a = p.auto;
      a.banda = 4000000; a.fator = 1; a.degrauBanda = 1; a.degrauFps = 1;
      p.larguraQueQuer = 0; p.perfilAplicado = null;
      await aplicarPerfilVideo(p);
      return {
        recebendo: quantosRecebem(),
        teto: p.senderVideo.getParameters().encodings[0].maxBitrate,
        certo: Math.round(4000000 * 0.85),
        errado: Math.round(4000000 * 0.85 / 2),
      };
    });
    info('com ' + divisao.recebendo + ' recebendo e 4 Mbps medidos: teto ' + Math.round(divisao.teto / 1000) + ' kbps');
    divisao.teto > divisao.errado * 1.5
      ? ok('a banda medida não é dividida de novo', Math.round(divisao.teto / 1000) + ' kbps, não ' + Math.round(divisao.errado / 1000))
      : mal('ainda dividindo duas vezes', Math.round(divisao.teto / 1000) + ' kbps');

    titulo('6b. Quem não assiste não divide a banda');
    const conta = await A.evaluate(() => {
      const gente = [...pares.values()];
      const antes = quantosRecebem();
      gente[0].naoAssiste = true;
      const depois = quantosRecebem();
      gente[0].naoAssiste = false;
      return { antes, depois };
    });
    (conta.antes === 2 && conta.depois === 1)
      ? ok('sai da divisão quem parou de assistir', conta.antes + ' → ' + conta.depois)
      : mal('continua dividindo com quem não assiste', JSON.stringify(conta));

    titulo('7. Cada um com a própria régua');
    const reguas = await A.evaluate(() => [...pares.values()].map(p => ({ nome: p.nome, temAuto: !!p.auto, fator: p.auto ? p.auto.fator : null })));
    reguas.every(r => r.temAuto) ? ok('régua separada para cada pessoa', JSON.stringify(reguas.map(r => r.fator)))
                                 : mal('alguém ficou sem régua', JSON.stringify(reguas));

    titulo('7. Erros');
    erros.length ? mal(erros.length + ' erro(s)') : ok('nenhum erro de JavaScript');
    erros.slice(0, 10).forEach(e => info(e));

  } catch (e) {
    mal('o teste explodiu', String(e && e.message || e));
  } finally {
    titulo('RESUMO');
    const bons = resultados.filter(r => r[0] === 'ok').length;
    const ruins = resultados.filter(r => r[0] === 'mal');
    console.log('  ' + bons + ' passaram, ' + ruins.length + ' falharam');
    ruins.forEach(r => console.log('    FALHOU: ' + r[1] + (r[2] ? '  (' + r[2] + ')' : '')));
    await nav.close(); servidor.close();
    process.exit(ruins.length ? 1 : 0);
  }
}
principal();
