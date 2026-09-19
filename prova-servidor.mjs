/* =====================================================================
 * PROVA DA TELA PELO SERVIDOR (SFU)
 * ---------------------------------------------------------------------
 * A transmite; B está "no app" (tem a ponte do servidor) e C está no
 * site puro. O que tem que acontecer:
 *   - A sobe a tela UMA vez para o servidor;
 *   - B puxa do servidor e vê a imagem; A não manda nada direto para B;
 *   - C, sem servidor, recebe direto como sempre;
 *   - A para: B solta o servidor, os quadros somem.
 * Usa o porteiro e o servidor de verdade: precisa da senha das contas
 * de teste em BIGAS_TESTE_SENHA (senão avisa e sai).
 * =================================================================== */
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const PASTA = 'C:/Users/BIGHOUSE/Downloads/frag-site';
const PORTA = 8099;
const BASE = 'http://localhost:' + PORTA + '/index.html';
const PORTEIRO = 'https://bigas-porteiro.andreluizvillanova123.workers.dev';
const CHAVE_FIREBASE = 'AIzaSyAoPF_DtMb2q6MPFi_3GTyAjvy_Cai0uIU';   // pública (a regra do servidor é que tranca)

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
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas');
    c.width = 1280; c.height = 720;
    const g = c.getContext('2d');
    let t = 0;
    const d = () => { t++; g.fillStyle = 'hsl(' + ((t * 3) % 360) + ',85%,55%)'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#fff'; g.font = '80px sans-serif'; g.fillText(String(t), 100, 200); requestAnimationFrame(d); };
    d();
    return c.captureStream(30);
  };
};
// a ponte que o app oferece ao site: {url do porteiro, token da conta}
const PONTE = ({ url, token }) => { window.bigasApp = { sfu: async () => ({ url, token }) }; };

const ESTADO = () => ({
  gente: [...pares.values()].map(p => ({
    id: p.id, nome: p.nome, conexao: p.pc ? p.pc.connectionState : '-',
    viaSfu: p.viaSfu || null, semSfu: !!p.semSfu, telaSfu: !!p.telaSfu,
    videoDireto: !!(p.senderVideo && p.senderVideo.track),
    largura: (document.getElementById('v-p-' + p.id) || {}).videoWidth || 0,
    quadro: !!document.getElementById('q-p-' + p.id),
  })),
  pub: !!SFU.pub, puxa: !!SFU.puxa, pulso: !!SFU.relogioPulso, falhouEm: SFU.falhouEm,
  transmitindo: !!est.streamTela,
});

async function tokenDeTeste(senha) {
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + CHAVE_FIREBASE, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'teste_bigas_a@bigasvoice.app', password: senha, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('login de teste: ' + JSON.stringify(j.error || j).slice(0, 120));
  return j.idToken;
}

async function principal() {
  const senha = process.env.BIGAS_TESTE_SENHA;
  if (!senha) { console.log('PULADO: defina BIGAS_TESTE_SENHA (senha das contas de teste) pra rodar esta prova.'); process.exit(0); }
  const token = await tokenDeTeste(senha);
  await new Promise(r => servidor.listen(PORTA, r));
  const nav = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
           '--autoplay-policy=no-user-gesture-required', '--disable-gpu-vsync'],
  });
  const erros = [];
  const fazer = async (rotulo, comPonte) => {
    const ctx = await nav.newContext({ permissions: ['microphone'], viewport: { width: 1100, height: 700 } });
    await ctx.addInitScript(TELA_FALSA);
    if (comPonte) await ctx.addInitScript(PONTE, { url: PORTEIRO, token });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => erros.push(rotulo + ' EXCECAO: ' + String(e.message).slice(0, 160)));
    pg.on('console', m => { if (m.type() === 'error' && !/429|Failed to load resource/.test(m.text())) erros.push(rotulo + ': ' + m.text().slice(0, 160)); });
    return pg;
  };
  const A = await fazer('A', true), B = await fazer('B', true), C = await fazer('C', false);

  try {
    titulo('1. A cria a sala, B (app) entra: com UM assistindo é direto, de graça');
    await A.goto(BASE, { waitUntil: 'load' });
    await A.fill('#meu-nome', 'Andre');
    await A.click('#btn-sala');
    if (!await ateQue(async () => (await A.inputValue('#sala-link')).includes('#e='), 40000)) { mal('sala não abriu'); throw new Error('sem sala'); }
    const link = await A.inputValue('#sala-link');
    await B.goto(link, { waitUntil: 'load' }); await B.fill('#meu-nome', 'Bruno');
    await B.evaluate(() => { window.__pulsos = []; const f = window.fetch; window.fetch = function (u, o) { try { if (/\/pulso$/.test(String(u)) && o && o.body) window.__pulsos.push(JSON.parse(o.body)); } catch (e) {} return f.apply(this, arguments); }; });
    const dois = await ateQue(async () => (await A.evaluate(ESTADO)).gente.some(g => g.conexao === 'connected') && (await B.evaluate(ESTADO)).gente.some(g => g.conexao === 'connected'), 60000, 700);
    dois ? ok('A e B conectados') : mal('A e B não conectaram');
    await A.click('#btn-tela');
    const direto1 = await ateQue(async () => { const b = await B.evaluate(ESTADO); return !(await A.evaluate(ESTADO)).pub && b.gente.some(g => g.nome === 'Andre' && !g.telaSfu && g.largura > 0); }, 25000, 500);
    direto1 ? ok('com 1 assistindo A NÃO usa o servidor: B recebe direto') : mal('gastou servidor com um só', JSON.stringify(await A.evaluate(ESTADO)));

    titulo('2. C (site puro) chega: agora são 2 → a tela sobe pro servidor');
    await C.goto(link, { waitUntil: 'load' }); await C.fill('#meu-nome', 'Carla');
    const subiu = await ateQue(async () => (await A.evaluate(ESTADO)).pub, 60000, 600);
    subiu ? ok('A subiu a tela para o servidor quando o segundo chegou') : mal('A não publicou no servidor', JSON.stringify(await A.evaluate(ESTADO)));
    const bVe = await ateQue(async () => { const b = await B.evaluate(ESTADO); return b.gente.some(g => g.nome === 'Andre' && g.telaSfu && g.largura > 0); }, 25000, 500);
    const eB = await B.evaluate(ESTADO);
    bVe ? ok('B passou a puxar do servidor e vê a imagem', eB.gente.find(g => g.nome === 'Andre').largura + 'px, pulso=' + eB.pulso) : mal('B não vê pelo servidor', JSON.stringify(eB));
    const cVe = await ateQue(async () => { const c = await C.evaluate(ESTADO); return c.gente.some(g => g.nome === 'Andre' && !g.telaSfu && g.largura > 0); }, 25000, 500);
    cVe ? ok('C (site puro) recebe direto') : mal('C não recebe', JSON.stringify(await C.evaluate(ESTADO)));
    await espera(1500);
    const eA = await A.evaluate(ESTADO);
    const pB = eA.gente.find(g => g.nome === 'Bruno'), pC = eA.gente.find(g => g.nome === 'Carla');
    (pB && pB.viaSfu === 'sim' && !pB.videoDireto) ? ok('A não manda mais nada direto para B') : mal('A ainda manda direto para B', JSON.stringify(pB));
    (pC && pC.semSfu && pC.videoDireto) ? ok('A manda direto para C') : mal('A não marcou C como direto', JSON.stringify(pC));
    (await A.evaluate(() => quantosRecebem())) === 1 ? ok('só C conta na divisão do upload') : mal('divisão errada');

    titulo('3. B sai da aba: solta o VÍDEO no servidor (o som fica); volta: puxa de novo');
    await B.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    const soltou = await ateQue(async () => { const b = await B.evaluate(() => [...pares.values()].map(p => ({ nome: p.nome, t: p.telaSfu && { solto: p.telaSfu.videoSolto, midAudio: !!p.telaSfu.midAudio, midVideo: !!p.telaSfu.midVideo }, quadro: !!document.getElementById('q-p-' + p.id) }))); const a = b.find(x => x.nome === 'Andre'); return a && a.t && a.t.solto && !a.t.midVideo && !a.quadro; }, 35000, 700);
    soltou ? ok('20 s fora da aba: vídeo solto no servidor, quadro fora do palco (a sessão fica pro som)') : mal('não soltou o vídeo', JSON.stringify(await B.evaluate(() => [...pares.values()].map(p => p.telaSfu))));
    await B.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    const voltou = await ateQue(async () => { const b = await B.evaluate(ESTADO); const a = b.gente.find(g => g.nome === 'Andre'); return a && a.telaSfu && a.largura > 0; }, 25000, 500);
    voltou ? ok('voltou pra aba: vídeo de volta pelo servidor') : mal('não voltou o vídeo', JSON.stringify(await B.evaluate(ESTADO)));
    if (!voltou) { (await B.evaluate(() => registro.marcos.slice(-14).map(m => Math.round(m.t / 1000) + 's ' + m.txt))).forEach(info); info('transceivers B: ' + await B.evaluate(() => JSON.stringify(SFU.puxa ? SFU.puxa.pc.getTransceivers().map(t => ({ mid: t.mid, dir: t.currentDirection, kind: t.receiver.track.kind, estado: t.receiver.track.readyState, muted: t.receiver.track.muted })) : null))); info('donos: ' + await B.evaluate(() => JSON.stringify(SFU.puxa ? [...SFU.puxa.donos.keys()] : null)) + ' telaSfu: ' + await B.evaluate(() => JSON.stringify([...pares.values()].map(p => p.telaSfu)))); }

    titulo('4. C sai: sobrou um → A volta pro direto e para de gastar');
    await C.evaluate(() => { try { darAdeus(); } catch (e) {} }); await C.close();
    const voltouDireto = await ateQue(async () => { const a = await A.evaluate(ESTADO); const b = await B.evaluate(ESTADO); return !a.pub && a.gente.length === 1 && b.gente.some(g => g.nome === 'Andre' && !g.telaSfu && g.largura > 0) && !b.puxa && !b.pulso; }, 40000, 700);
    voltouDireto ? ok('A fechou a publicação e B recebe direto de novo (sem pulso, sem sessão)') : mal('não voltou pro direto', JSON.stringify({ A: await A.evaluate(ESTADO), B: await B.evaluate(ESTADO) }));
    const pulsos = await B.evaluate(() => window.__pulsos);
    const comBytes = pulsos.filter(p => Number(p.bytes) > 0);
    (pulsos.length && pulsos.every(p => 'bytes' in p) && comBytes.length) ? ok('os pulsos levam os bytes recebidos de verdade', pulsos.length + ' pulso(s), ' + Math.round(comBytes.reduce((s, p) => s + p.bytes, 0) / 1e6) + ' MB contados') : mal('pulso sem bytes', JSON.stringify(pulsos));

    titulo('5. A para');
    await A.click('#btn-tela');
    const limpou = await ateQue(async () => !(await B.evaluate(ESTADO)).gente.some(g => g.quadro) && !(await A.evaluate(ESTADO)).transmitindo, 15000, 500);
    limpou ? ok('B limpou o quadro') : mal('sobrou quadro');

    titulo('6. Sem porteiro, tudo vai direto');
    const C2 = await fazer('C2', false);
    await C2.goto(link, { waitUntil: 'load' }); await C2.fill('#meu-nome', 'Caio');
    await ateQue(async () => (await A.evaluate(ESTADO)).gente.filter(g => g.conexao === 'connected').length === 2, 60000, 700);
    await B.evaluate(() => { window.bigasApp.sfu = async () => { throw new Error('porteiro fora'); }; });
    await A.evaluate(() => { window.bigasApp.sfu = async () => { throw new Error('porteiro fora'); }; });
    await A.click('#btn-tela');
    const direto = await ateQue(async () => { const b = await B.evaluate(ESTADO); const a = await A.evaluate(ESTADO); return !a.pub && b.gente.some(g => g.nome === 'Andre' && !g.telaSfu && g.largura > 0); }, 25000, 500);
    direto ? ok('sem servidor, B recebe direto mesmo com 2 na call') : mal('B ficou sem imagem', JSON.stringify(await B.evaluate(ESTADO)));
    await A.click('#btn-tela');
    await C2.close();

    titulo('5. Erros');
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
