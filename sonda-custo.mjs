/* =====================================================================
 * QUANTO CUSTAM, EM MILISSEGUNDOS, AS DUAS FUNÇÕES ACUSADAS
 * ---------------------------------------------------------------------
 * Duas acusações concretas:
 *   1. pintarGente() destrói e recria o DOM inteiro (innerHTML='')
 *   2. atualizarNumeros() cria lixo todo segundo e provoca pausa de GC
 *
 * As duas são plausíveis. Nenhuma das duas foi medida. Reescrever
 * qualquer uma custa risco num código com 24 chamadores, então primeiro
 * o número: quanto tempo elas realmente tomam da linha principal?
 *
 * Referência: um quadro a 60 fps tem 16,7 ms. Qualquer coisa abaixo de
 * ~1 ms é ruído; acima de ~4 ms começa a doer.
 * =================================================================== */
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const PASTA = 'C:/Users/BIGHOUSE/Downloads/frag-site';
const PORTA = 8105;
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

function linha(nome, r) {
  console.log('  ' + nome.padEnd(26) +
    ('média ' + r.media.toFixed(3) + ' ms').padStart(18) +
    ('  pior ' + r.pior.toFixed(3) + ' ms').padStart(18) +
    ('  total ' + r.total.toFixed(1) + ' ms').padStart(18));
}

async function principal() {
  await new Promise(r => servidor.listen(PORTA, r));
  const nav = await chromium.launch({ args: [
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required'] });
  const faz = async () => {
    const c = await nav.newContext({ permissions: ['microphone'], viewport: { width: 1600, height: 900 } });
    await c.addInitScript(TELA); return c.newPage();
  };
  const A = await faz(), B = await faz();

  try {
    await A.goto(BASE, { waitUntil: 'load' });
    await A.fill('#meu-nome', 'Andre'); await A.click('#btn-sala');
    if (!await ate(async () => (await A.inputValue('#sala-link')).includes('#e='), 40000))
      throw new Error('a sala não saiu');
    const link = await A.inputValue('#sala-link');
    await B.goto(link, { waitUntil: 'load' });
    await B.fill('#meu-nome', 'Bruno');
    await ate(async () => await A.evaluate(
      () => [...pares.values()].some(p => p.pc && p.pc.connectionState === 'connected')), 60000);
    await A.click('#btn-tela');
    await espera(8000);

    console.log('\n=== CUSTO REAL DAS DUAS FUNÇÕES (1 amigo na call) ===');
    console.log('  referência: um quadro a 60 fps tem 16,7 ms\n');

    const medir = await A.evaluate(async () => {
      const cronometrar = async (f, voltas) => {
        const t = [];
        for (let i = 0; i < voltas; i++) {
          const a = performance.now();
          await f();
          t.push(performance.now() - a);
        }
        return { media: t.reduce((x, y) => x + y, 0) / t.length,
                 pior: Math.max(...t), total: t.reduce((x, y) => x + y, 0) };
      };
      const gente = await cronometrar(() => pintarGente(), 200);
      const numeros = await cronometrar(() => atualizarNumeros(), 60);
      return { gente, numeros, quantos: pares.size };
    });
    linha('pintarGente() x200', medir.gente);
    linha('atualizarNumeros() x60', medir.numeros);

    /* agora com a call cheia: 5 amigos fingidos, que é o pior caso real */
    console.log('\n=== O MESMO COM A CALL CHEIA (5 amigos) ===');
    const cheio = await A.evaluate(async () => {
      const falsos = [];
      for (let i = 0; i < 4; i++) {
        const id = 'falso' + i;
        const p = { id, nome: 'Amigo ' + i, mudo: i % 2 === 0, falando: false,
                    conectado: true, volume: 100, qualidadeDele: '1080-60-8' };
        pares.set(id, p); falsos.push(id);
      }
      const t = [];
      for (let i = 0; i < 200; i++) {
        const a = performance.now(); pintarGente(); t.push(performance.now() - a);
      }
      falsos.forEach(id => pares.delete(id));
      pintarGente();
      return { media: t.reduce((x, y) => x + y, 0) / t.length,
               pior: Math.max(...t), total: t.reduce((x, y) => x + y, 0) };
    });
    linha('pintarGente() x200 (5 pessoas)', cheio);

    /* quanto lixo o laço de estatísticas realmente gera */
    console.log('\n=== O LIXO DO LAÇO DE ESTATÍSTICAS ===');
    const lixo = await A.evaluate(async () => {
      if (!performance.memory) return null;
      const antes = performance.memory.usedJSHeapSize;
      for (let i = 0; i < 60; i++) await atualizarNumeros();
      const depois = performance.memory.usedJSHeapSize;
      return { antes, depois, delta: depois - antes };
    });
    if (!lixo) console.log('  (este navegador não expõe performance.memory)');
    else console.log('  60 voltas do laço criaram ' + Math.round(lixo.delta / 1024) +
                     ' KB de lixo  (' + Math.round(lixo.delta / 60 / 1024) + ' KB por volta)');

    console.log('\n=== VEREDITO ===');
    const p1 = cheio.pior, m1 = cheio.media, m2 = medir.numeros.media;
    console.log('  pintarGente com a call cheia: ' + m1.toFixed(2) + ' ms em média, pior ' + p1.toFixed(2) + ' ms');
    console.log('    -> ' + (m1 > 4 ? 'VALE reescrever com atualização no lugar (DOM diffing).'
      : m1 > 1 ? 'custo pequeno; vale só se for barato de fazer.'
      : 'RUÍDO. Reescrever isso é otimização prematura.'));
    console.log('  atualizarNumeros: ' + m2.toFixed(2) + ' ms por volta, uma vez por segundo');
    console.log('    -> ' + (m2 > 4 ? 'VALE atacar as alocações.'
      : 'ele roda 1x por segundo; ' + (m2 / 1000 * 100).toFixed(3) + '% do tempo da linha principal.'));

  } catch (e) { console.log('explodiu: ' + ((e && e.message) || e)); }
  finally { await nav.close(); servidor.close(); process.exit(0); }
}
principal();
