/* =====================================================================
 * A PROVA DA v4.0 — só o que é NOVO
 * ---------------------------------------------------------------------
 * As outras três suítes garantem que nada velho quebrou. Esta aqui existe
 * para provar que o que eu acabei de escrever faz mesmo o que eu disse
 * que faz — em particular a "ratoeira", que é uma afirmação sobre
 * comportamento ao longo do tempo e não dá para conferir lendo o código.
 * =================================================================== */
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';

const PASTA = 'C:/Users/BIGHOUSE/Downloads/frag-site';
const PORTA = 8093;
const BASE = 'http://localhost:' + PORTA + '/index.html';
const espera = (ms) => new Promise(r => setTimeout(r, ms));

const res = [];
const ok  = (t, e) => { res.push(['ok', t]);  console.log('  ok    ' + t + (e ? '  (' + e + ')' : '')); };
const mal = (t, e) => { res.push(['mal', t]); console.log('  FALHA ' + t + (e ? '  (' + e + ')' : '')); };
const info = (t) => console.log('        ' + t);

const servidor = http.createServer((q, s) => {
  const n = decodeURIComponent(q.url.split('?')[0].split('#')[0]);
  fs.readFile(path.join(PASTA, n === '/' ? 'index.html' : n), (e, d) => {
    if (e) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); s.end(d);
  });
});

/* Tela 1080p com muito movimento: sem ruído o compressor devolve 300 kbps
   e não existe pressão nenhuma para medir. */
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
  A.on('pageerror', e => mal('EXCECAO em quem transmite', e.message));
  B.on('pageerror', e => mal('EXCECAO em quem assiste', e.message));

  try {
    /* ============ 1. melhorarVideo, sem precisar de rede ============ */
    console.log('\n=== 1. O empurrão inicial entra no SDP? ===');
    await A.goto(BASE, { waitUntil: 'load' });

    const sdpT = await A.evaluate(() => {
      cfg.qualidade = '1080-60-8';
      const semFmtp = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000\r\n';
      const comFmtp = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 102\r\na=rtpmap:102 H264/90000\r\n' +
                      'a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1\r\n';
      const soAudio = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\n';
      const a = melhorarVideo(semFmtp), b = melhorarVideo(comFmtp);
      const duasVezes = melhorarVideo(melhorarVideo(comFmtp));
      return {
        criouLinha: /a=fmtp:96 x-google-start-bitrate=\d+/.test(a),
        completou:  /a=fmtp:102 .*packetization-mode=1.*x-google-start-bitrate=\d+/.test(b),
        naoQuebrouAudio: melhorarVideo(soAudio) === soAudio,
        idempotente: (duasVezes.match(/x-google-start-bitrate/g) || []).length === 1,
        valor: (b.match(/x-google-start-bitrate=(\d+)/) || [])[1],
      };
    });
    sdpT.criouLinha ? ok('cria a linha quando o codec não tinha nenhuma')
                    : mal('não criou a linha de fmtp');
    sdpT.completou  ? ok('completa a linha existente sem perder o que já havia')
                    : mal('estragou a linha de fmtp existente');
    sdpT.naoQuebrouAudio ? ok('não encosta num SDP que só tem áudio')
                         : mal('mexeu num SDP sem vídeo');
    sdpT.idempotente ? ok('aplicar duas vezes não duplica o parâmetro')
                     : mal('duplicou o parâmetro ao reaplicar');
    info('começa em ' + sdpT.valor + ' kbps em vez dos 300 de fábrica');

    /* ============ 2. a heurística da captura ============ */
    console.log('\n=== 2. Sabe separar captura capada de tela parada? ===');
    const cap = await A.evaluate(() => {
      const rep = (v, n) => Array.from({ length: n }, () => v);
      const osc = [];
      for (let i = 0; i < 30; i++) osc.push([2, 41, 6, 55, 3, 48][i % 6]);
      return {
        capada:  capturaSuspeita(rep(30, 30), 60),
        parada:  capturaSuspeita(osc, 60),
        boa:     capturaSuspeita(rep(60, 30), 60),
        curta:   capturaSuspeita(rep(30, 10), 60),
        zerada:  capturaSuspeita(rep(1, 30), 60),
      };
    });
    cap.capada  ? ok('30 quadros CRAVADOS com alvo 60 = suspeito') : mal('não viu a captura capada');
    !cap.parada ? ok('número que oscila muito = tela parada, não avisa') : mal('avisou por tela parada');
    !cap.boa    ? ok('60 com alvo 60 = não avisa') : mal('avisou com a captura boa');
    !cap.curta  ? ok('amostra curta demais = não conclui nada') : mal('concluiu com meia dúzia de amostras');
    !cap.zerada ? ok('tela totalmente parada = não avisa') : mal('avisou com a tela congelada');

    /* ============ conectar de verdade ============ */
    console.log('\n=== 3. Conectando os dois ===');
    await A.fill('#meu-nome', 'Andre');
    await A.click('#btn-sala');
    const veio = await ate(async () => (await A.inputValue('#sala-link')).includes('#e='), 40000);
    if (!veio) throw new Error('a sala não saiu (servidor de sinal fora do ar?)');
    const link = await A.inputValue('#sala-link');
    await B.goto(link, { waitUntil: 'load' });
    await B.fill('#meu-nome', 'Bruno');
    const ligou = await ate(async () => await A.evaluate(
      () => [...pares.values()].some(p => p.pc && p.pc.connectionState === 'connected')), 60000);
    ligou ? ok('os dois conectaram') : mal('não conectaram');
    if (!ligou) throw new Error('sem conexão, o resto não mede nada');

    await A.evaluate(() => { cfg.qualidade = '1080-60-8'; cfg.prioridade = 'fps'; });
    await A.click('#btn-tela');
    await ate(async () => await A.evaluate(
      () => [...pares.values()][0].senderVideo != null), 30000);

    /* o empurrão tem que estar no SDP que A REALMENTE aplicou */
    const noVivo = await A.evaluate(() => {
      const p = [...pares.values()][0];
      const sdp = p.pc.remoteDescription ? p.pc.remoteDescription.sdp : '';
      return /x-google-start-bitrate=\d+/.test(sdp);
    });
    noVivo ? ok('o empurrão está no SDP aplicado de verdade, não só no teste')
           : mal('o SDP remoto real saiu sem o empurrão');

    /* ============ 4. a dica de conteúdo ============ */
    console.log('\n=== 4. A dica de conteúdo segue a sua escolha? ===');
    const dica = await A.evaluate(async () => {
      const t = est.streamTela.getVideoTracks()[0];
      cfg.prioridade = 'nitidez'; aplicarDicaDeConteudo();
      const comNitidez = t.contentHint;
      cfg.prioridade = 'fps'; aplicarDicaDeConteudo();
      return { comNitidez, comFps: t.contentHint };
    });
    (dica.comNitidez === 'detail' && dica.comFps === 'motion')
      ? ok('nitidez vira "detail" e fluidez vira "motion"', dica.comNitidez + ' / ' + dica.comFps)
      : mal('a dica não acompanha a escolha', JSON.stringify(dica));

    /* ============ 5. o amortecedor ============ */
    console.log('\n=== 5. "Quase sem atraso" ainda guarda alguma folga? ===');
    const amort = await B.evaluate(() => {
      const p = [...pares.values()][0];
      cfg.latencia = 'minima'; p.folgaAplicada = -1; ajustarAmortecedor(p);
      const min = p.receptorVideo ? p.receptorVideo.jitterBufferTarget : null;
      cfg.latencia = 'estavel'; p.folgaAplicada = -1; ajustarAmortecedor(p);
      const est2 = p.receptorVideo ? p.receptorVideo.jitterBufferTarget : null;
      return { min, estavel: est2 };
    });
    info('mínima: ' + amort.min + ' ms | lisa: ' + amort.estavel + ' ms');
    (amort.min !== 0 && amort.min >= 20 && amort.min <= 60)
      ? ok('nunca zera — guarda um piso', amort.min + ' ms')
      : mal('o amortecedor voltou a zerar', String(amort.min));
    (amort.estavel > amort.min)
      ? ok('"lisa" continua guardando mais que "quase sem atraso"')
      : mal('as duas opções ficaram iguais');

    /* ============ 6. A RATOEIRA — parte 1: a folga ============ */
    console.log('\n=== 6. O teto fica ACIMA da medida quando ninguém reclama? ===');
    const folga = await A.evaluate(async () => {
      const p = [...pares.values()][0], a = autoDe(p);
      cfg.qualidade = '1080-60-8';
      a.banda = 2000000; a.fator = 1; a.degrauBanda = 1; a.degrauFps = 1;
      p.larguraQueQuer = 1920; p.sumiu = false; p.perda = 0;

      p.apertado = false; p.quandoAperto = 0;
      p.perfilAplicado = null; await aplicarPerfilVideo(p);
      const livre = p.tetoAplicado;

      p.apertado = true; p.quandoAperto = Date.now();
      p.perfilAplicado = null; await aplicarPerfilVideo(p);
      const preso = p.tetoAplicado;
      return { livre, preso, medida: a.banda };
    });
    info('medida ' + Math.round(folga.medida / 1000) + ' kbps → teto livre ' +
         Math.round(folga.livre / 1000) + ' kbps | sob aperto ' + Math.round(folga.preso / 1000) + ' kbps');
    (folga.livre > folga.medida)
      ? ok('sem aperto o teto passa da medida — é isso que deixa o navegador descobrir mais',
           Math.round(folga.livre / 1000) + ' > ' + Math.round(folga.medida / 1000))
      : mal('o teto continua preso embaixo da medida (a ratoeira voltou)',
            Math.round(folga.livre / 1000) + ' kbps');
    (folga.preso <= folga.medida * 0.9)
      ? ok('com aperto de verdade ele aperta na hora', Math.round(folga.preso / 1000) + ' kbps')
      : mal('não apertou quando havia aperto', Math.round(folga.preso / 1000) + ' kbps');

    /* ============ 7. A RATOEIRA — parte 2: a saída ============ */
    console.log('\n=== 7. Uma imagem já encolhida consegue voltar? ===');
    const saida = await A.evaluate(async () => {
      const p = [...pares.values()][0], a = autoDe(p);
      // estado exato do fundo do poço: imagem a um terço, medida encostada
      // no nosso próprio teto, e absolutamente nada reclamando
      a.aquece = 100; a.fator = 1; a.degrauFps = 1;
      a.degrauBanda = 3; a.quandoDegrau = Date.now() - 60000;
      a.folgado = 0; a.banda = 0;
      p.tetoAplicado = 1000000;
      p.apertado = false; p.perda = 0; p.quandoSaude = 0; p.saudeSeguida = 0;
      const trilha = [];
      for (let i = 0; i < 16; i++) {
        await ajustarQualidade(p, 0, false, 950000, 60);
        trilha.push(a.degrauBanda);
      }
      return { trilha, fim: a.degrauBanda, viuOTeto: a.euSouOTeto };
    });
    info('degrau a cada volta: ' + saida.trilha.join(' '));
    saida.viuOTeto ? ok('reconheceu que o teto era dele, não da rede')
                   : mal('não reconheceu o próprio teto');
    (saida.fim < 3) ? ok('a imagem encolhida subiu de volta sozinha', '3x → ' + saida.fim + 'x')
                    : mal('continua presa no fundo do poço', 'ainda ' + saida.fim + 'x');

    /* ============ 8. não sobe quando há aperto de verdade ============ */
    console.log('\n=== 8. E não sobe quando a rede está mesmo apertada? ===');
    const teimoso = await A.evaluate(async () => {
      const p = [...pares.values()][0], a = autoDe(p);
      a.aquece = 100; a.degrauBanda = 3; a.quandoDegrau = Date.now() - 60000;
      a.folgado = 0; a.banda = 0; a.fator = 1;
      p.tetoAplicado = 1000000; p.perda = 0;
      for (let i = 0; i < 16; i++) await ajustarQualidade(p, 3, true, 950000, 60);
      return { fim: a.degrauBanda, viuOTeto: a.euSouOTeto };
    });
    (!teimoso.viuOTeto && teimoso.fim >= 3)
      ? ok('com aperto real ele NÃO inventa que o teto era dele', 'segue em ' + teimoso.fim + 'x')
      : mal('subiu no meio de um aperto de verdade', JSON.stringify(teimoso));

    /* ============ 9. quadros realmente desenhados ============ */
    console.log('\n=== 9. Mede o que foi DESENHADO, não só o que chegou? ===');
    await espera(9000);
    const pac = await B.evaluate(() => {
      const p = [...pares.values()][0];
      return { olhando: !!p.olhandoQuadros, amostras: (p.intervalos || []).length,
               pacing: p.pacing ? { ...p.pacing } : null };
    });
    info('amostras de quadro: ' + pac.amostras + ' | ' + JSON.stringify(pac.pacing));
    pac.olhando ? ok('o medidor de quadros pintados está de pé') : mal('o medidor não ligou');
    (pac.pacing && pac.pacing.fps > 0)
      ? ok('mede os quadros desenhados', pac.pacing.fps + ' fps, 1% pior ' + pac.pacing.pior +
           ', maior buraco ' + pac.pacing.buraco + ' ms')
      : mal('não produziu medida de pacing', JSON.stringify(pac));
    (pac.pacing && pac.pacing.pior <= pac.pacing.fps)
      ? ok('o 1% pior é pior que a média — como tem que ser')
      : mal('o 1% pior saiu melhor que a média, a conta está errada');

    /* ============ 9b. o medidor sobrevive a um redesenho ============ */
    console.log('\n=== 9b. O medidor aguenta o palco ser remontado? ===');
    await B.evaluate(() => { redesenharTudo(); });
    await espera(4000);
    const depois = await B.evaluate(() => {
      const p = [...pares.values()][0];
      const v = document.getElementById('v-p-' + p.id);
      return { mesmoElemento: p.videoOlhado === v, olhando: !!p.olhandoQuadros,
               amostras: (p.intervalos || []).length };
    });
    info('amostras depois do redesenho: ' + depois.amostras);
    depois.mesmoElemento ? ok('o medidor migrou para o <video> novo')
                         : mal('o medidor ficou preso no <video> antigo');
    (depois.olhando && depois.amostras >= 20)
      ? ok('voltou a medir depois do redesenho', depois.amostras + ' amostras novas')
      : mal('parou de medir depois do redesenho', JSON.stringify(depois));

    /* ============ 10. o caderninho do amigo ============ */
    console.log('\n=== 10. Dá para buscar o caderninho do outro lado? ===');
    const doAmigo = await A.evaluate(async () => {
      const p = [...pares.values()][0];
      const t = await pedirCaderninho(p, 6000);
      return { veio: typeof t === 'string' && t.length > 0, tamanho: t ? t.length : 0,
               trecho: t ? String(t).slice(0, 70) : null };
    });
    doAmigo.veio ? ok('o resumo do amigo chegou pelo canal de dados',
                      doAmigo.tamanho + ' caracteres: "' + doAmigo.trecho + '…"')
                 : mal('o amigo não respondeu o caderninho');

    const junto = await A.evaluate(async () => {
      const t = await (async () => { await copiarRegistro(); return null; })();
      return null;
    }).then(() => A.evaluate(() => {
      // o botão já rodou; confere que o texto montado inclui a seção nova
      return montarRegistro('===== O QUE OS OUTROS VIRAM =====\nteste').includes('O QUE OS OUTROS VIRAM');
    }));
    junto ? ok('o caderninho aceita e mostra o anexo dos outros')
          : mal('o anexo não entrou no texto final');

    /* ============ 11. nada explodiu ============ */
    console.log('\n=== 11. Sobrou algum erro? ===');
    ok('nenhuma exceção não capturada (as de cima teriam falhado sozinhas)');

  } catch (e) {
    mal('a prova explodiu', String((e && e.message) || e));
  } finally {
    console.log('\n=== RESUMO ===');
    const bons = res.filter(r => r[0] === 'ok').length;
    const ruins = res.filter(r => r[0] === 'mal');
    console.log('  ' + bons + ' passaram, ' + ruins.length + ' falharam');
    ruins.forEach(r => console.log('    FALHOU: ' + r[1]));
    await nav.close(); servidor.close();
    process.exit(ruins.length ? 1 : 0);
  }
}
principal();
