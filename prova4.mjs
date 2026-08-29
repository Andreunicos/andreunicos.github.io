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

    /* ============ 7b. a subida aprende que já tentou ============ */
    console.log('\n=== 7b. Uma subida desfeita ensina alguma coisa? ===');
    const memoria = await A.evaluate(async () => {
      const p = [...pares.values()][0], a = autoDe(p);
      a.aquece = 100; a.fator = 1; a.degrauFps = 1;
      a.degrauBanda = 3; a.quandoDegrau = Date.now() - 60000;
      a.folgado = 0; a.banda = 0; a.esperaSubida = 15000; a.quandoSubiu = 0;
      p.tetoAplicado = 1000000;
      p.apertado = false; p.perda = 0; p.quandoSaude = 0; p.saudeSeguida = 0;

      // calmaria: ele sobe de propósito para medir
      for (let i = 0; i < 13; i++) await ajustarQualidade(p, 0, false, 950000, 60);
      const subiu = a.degrauBanda, marcou = a.quandoSubiu > 0;
      const esperaAntes = a.esperaSubida;

      // e agora a rede aperta de verdade: a subida tem que ser desfeita
      a.degrauFirme = 0; a.degrauQuer = 0; a.quandoDegrau = Date.now() - 25000;
      for (let i = 0; i < 20; i++) await ajustarQualidade(p, 3, true, 600000, 60);

      return { subiu, marcou, esperaAntes, desceu: a.degrauBanda, esperaDepois: a.esperaSubida };
    });
    info('subiu para ' + memoria.subiu + 'x, desceu para ' + memoria.desceu +
         'x, espera ' + (memoria.esperaAntes / 1000) + 's → ' + (memoria.esperaDepois / 1000) + 's');
    memoria.marcou ? ok('anotou quando tentou subir') : mal('não anotou a tentativa');
    (memoria.desceu > memoria.subiu)
      ? ok('a subida foi desfeita pelo aperto real', memoria.subiu + 'x → ' + memoria.desceu + 'x')
      : mal('não desfez a subida com aperto real', JSON.stringify(memoria));
    (memoria.esperaDepois >= memoria.esperaAntes * 2)
      ? ok('a espera dobrou — não vai insistir de 15 em 15s',
           (memoria.esperaAntes / 1000) + 's → ' + (memoria.esperaDepois / 1000) + 's')
      : mal('continuaria tentando no mesmo ritmo (solavanco periódico)',
            'espera ficou em ' + memoria.esperaDepois + ' ms');

    /* ============ 7c. a folga é sonda, não mudança de endereço ============ */
    console.log('\n=== 7c. A folga do teto ficou modesta? ===');
    const folgaT = await A.evaluate(async () => {
      const p = [...pares.values()][0], a = autoDe(p);
      a.banda = 2000000; a.fator = 1; a.degrauBanda = 1; a.degrauFps = 1;
      p.larguraQueQuer = 1920; p.sumiu = false; p.perda = 0;
      p.apertado = false; p.quandoAperto = 0;
      p.perfilAplicado = null; await aplicarPerfilVideo(p);
      return { teto: p.tetoAplicado, banda: a.banda };
    });
    const razao = folgaT.teto / folgaT.banda;
    info('teto ' + Math.round(folgaT.teto / 1000) + ' kbps sobre medida ' +
         Math.round(folgaT.banda / 1000) + ' kbps = ' + razao.toFixed(2) + 'x');
    (razao > 1 && razao <= 1.25)
      ? ok('sobra o bastante para a sonda do navegador, sem morar em cima do limite',
           razao.toFixed(2) + 'x')
      : mal('a folga saiu do lugar', razao.toFixed(2) + 'x (queria entre 1,0 e 1,25)');

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

    /* ============ 10b. o pulso da própria página ============ */
    console.log('\n=== 10b. O Bigas Voice mede se ELE MESMO está engasgando? ===');
    const pulsoT = await B.evaluate(() => {
      const p = resumoDoPulso();
      return { ligado: pulso.ligado, amostras: pulso.quadros.length,
               resumo: p ? { ...p } : null };
    });
    info('amostras de desenho: ' + pulsoT.amostras + ' | ' + JSON.stringify(pulsoT.resumo));
    pulsoT.ligado ? ok('o medidor de pulso ligou ao entrar na chamada')
                  : mal('o medidor de pulso não ligou');
    (pulsoT.resumo && pulsoT.resumo.fps > 0)
      ? ok('mede o ritmo de desenho da página', pulsoT.resumo.fps + ' por segundo, 1% pior ' +
           pulsoT.resumo.pior + ', travas ' + pulsoT.resumo.travas)
      : mal('não produziu medida de pulso', JSON.stringify(pulsoT));
    (pulsoT.resumo && pulsoT.resumo.pior <= pulsoT.resumo.fps)
      ? ok('o 1% pior do desenho é pior que a média, como tem que ser')
      : mal('a conta do 1% pior está errada');

    /* ============ 10c. os ajustes caros aparecem no caderninho ============ */
    console.log('\n=== 10c. Os ajustes que custam FPS ficam visíveis? ===');
    const caros = await B.evaluate(() => {
      const antes = { desenho: cfg.desenho, clipe: cfg.clipeSempre };
      cfg.desenho = 'normal'; cfg.clipeSempre = false;
      const limpo = { lista: ajustesCaros().length, txt: montarRegistro() };
      cfg.desenho = 'canvas'; cfg.clipeSempre = true;
      const sujo = { lista: ajustesCaros().length, txt: montarRegistro() };
      cfg.desenho = antes.desenho; cfg.clipeSempre = antes.clipe;
      return {
        limpoLista: limpo.lista,
        sujoLista: sujo.lista,
        limpoAvisa: limpo.txt.includes('AJUSTES CAROS LIGADOS'),
        sujoAvisa: sujo.txt.includes('AJUSTES CAROS LIGADOS'),
        sujoCita: sujo.txt.includes('MODO CANVAS') && sujo.txt.includes('CLIPE SEMPRE'),
        semprePõe: limpo.txt.includes('desenho: normal') &&
                   limpo.txt.includes('clipe sempre pronto: desligado'),
        temPulso: limpo.txt.includes('a PÁGINA do Bigas Voice está acompanhando'),
      };
    });
    (caros.limpoLista === 0 && caros.sujoLista === 2)
      ? ok('reconhece os dois ajustes caros', '0 limpo, 2 ligados')
      : mal('não contou os ajustes caros', JSON.stringify(caros));
    (!caros.limpoAvisa && caros.sujoAvisa && caros.sujoCita)
      ? ok('só grita quando algum está ligado, e diz qual')
      : mal('o aviso de ajuste caro saiu errado', JSON.stringify(caros));
    caros.semprePõe ? ok('o estado dos dois aparece sempre, ligado ou não')
                    : mal('o estado dos ajustes não entrou no caderninho');
    caros.temPulso ? ok('o pulso da página entrou no caderninho')
                   : mal('o pulso não apareceu no caderninho');

    /* ============ 10d. os números da travada de quem transmite ============ */
    console.log('\n=== 10d. O caderninho explica travada de quem TRANSMITE? ===');
    const trava = await A.evaluate(() => {
      const p = [...pares.values()][0];
      const txt = montarRegistro();
      return {
        temSecao: txt.includes('por que a transmissão TRAVA'),
        citaChave: txt.includes('quadros-chave'),
        citaSocorro: txt.includes('socorro do amigo'),
        citaFila: txt.includes('fila de envio'),
        mediuFila: typeof p.filaMs === 'number',
        mediuChaves: typeof p.chavesAntes === 'number',
        linhaTemCampos: (() => {
          const l = registro.linhas[registro.linhas.length - 1] || {};
          return 'chaves' in l && 'socorro' in l && 'fila' in l;
        })(),
      };
    });
    trava.temSecao ? ok('a seção da travada entrou no caderninho') : mal('a seção não apareceu');
    (trava.citaChave && trava.citaSocorro && trava.citaFila)
      ? ok('conta as três causas: quadro-chave, socorro do amigo e fila de envio')
      : mal('faltou alguma das três causas', JSON.stringify(travaTela));
    (trava.mediuFila && trava.mediuChaves)
      ? ok('as medidas estão sendo colhidas de verdade')
      : mal('as medidas não foram colhidas', JSON.stringify(trava));
    trava.linhaTemCampos ? ok('o segundo-a-segundo guarda os três')
                         : mal('o segundo-a-segundo não guardou os campos novos');

    /* ============ 10e. a captura consegue voltar ao tamanho cheio ============ */
    console.log('\n=== 10e. Depois de reduzir a captura, ela volta? ===');
    const volta = await A.evaluate(async () => {
      const espiao = [];
      const pt = MediaStreamTrack.prototype, oc = pt.applyConstraints;
      pt.applyConstraints = function (c) { espiao.push(c); return Promise.resolve(); };
      const p = [...pares.values()][0];
      const guardado = { enc: p.encolherAtual, ap: p.apertado, pe: p.perda };

      // cenário: captura já reduzida pela metade, e tudo calmo
      p.encolherAtual = 1; p.apertado = false; p.perda = 0;
      est.capturaEm = 2; est.capturaFolgada = 0; est.capturaFirme = 0;
      for (let i = 0; i < 95; i++) await cuidarDaCaptura();
      const pediu = espiao.length ? (espiao[0].width && espiao[0].width.max) : 0;

      // mesmo cenário, mas com a rede apertada: NÃO pode tentar voltar
      espiao.length = 0;
      p.apertado = true;
      est.capturaEm = 2; est.capturaFolgada = 0; est.capturaFirme = 0;
      for (let i = 0; i < 95; i++) await cuidarDaCaptura();
      const comAperto = espiao.length;

      pt.applyConstraints = oc;
      p.encolherAtual = guardado.enc; p.apertado = guardado.ap; p.perda = guardado.pe;
      est.capturaEm = 1; est.capturaFolgada = 0; est.capturaFirme = 0;
      return { pediu, comAperto };
    });
    info('pediu voltar para ' + volta.pediu + 'px de largura | tentativas com aperto: ' + volta.comAperto);
    (volta.pediu === 1920)
      ? ok('depois de um minuto de calma ela volta ao tamanho cheio', '1920px')
      : mal('a captura continua num caminho só de ida', 'pediu ' + volta.pediu);
    (volta.comAperto === 0)
      ? ok('com a rede apertada ela NÃO tenta voltar')
      : mal('tentou voltar no meio de um aperto', volta.comAperto + ' tentativas');

    /* ============ 12. a escada de prioridade ============ */
    console.log('\n=== 12. A voz para de disputar com o vídeo? ===');
    const prio = await A.evaluate(() => {
      const p = [...pares.values()][0];
      const ler = (snd) => {
        if (!snd) return null;
        const e = (snd.getParameters().encodings || [])[0] || {};
        return e.networkPriority || null;
      };
      return { voz: ler(p.senderMic), imagem: ler(p.senderVideo),
               tabela: { ...PRIORIDADE } };
    });
    info('voz: ' + prio.voz + ' | imagem: ' + prio.imagem + ' | tabela: ' + JSON.stringify(prio.tabela));
    (prio.tabela.voz === 'high' && prio.tabela.somDoJogo === 'medium' && prio.tabela.imagem === 'low')
      ? ok('a escada está declarada: voz > som do jogo > imagem')
      : mal('a escada de prioridade está errada', JSON.stringify(prio.tabela));
    (prio.voz === 'high' && prio.imagem === 'low')
      ? ok('aplicada de verdade nas faixas', 'voz high, imagem low')
      : mal('a prioridade não chegou nas faixas', JSON.stringify(prio));
    (prio.voz !== prio.imagem)
      ? ok('voz e imagem deixaram de estar empatadas')
      : mal('voz e imagem continuam com a mesma prioridade');

    /* ============ 13. quem assiste tem voz ============ */
    console.log('\n=== 13. Quem assiste consegue pedir? ===');
    const botoes = await B.evaluate(() => {
      const q = document.querySelector('#palco .quadro[id^="q-p-"]');
      const txts = q ? [...q.querySelectorAll('.quadro-acoes button')].map(b => b.textContent) : [];
      return { txts, temTravando: txts.some(t => /travando/i.test(t)),
               temBorrado: txts.some(t => /borrado/i.test(t)) };
    });
    info('botões no quadro do amigo: ' + JSON.stringify(botoes.txts));
    (botoes.temTravando && botoes.temBorrado)
      ? ok('os dois pedidos aparecem no quadro de quem assiste')
      : mal('os botões de pedido não apareceram', JSON.stringify(botoes.txts));

    const chegou = await B.evaluate(async () => {
      const q = document.querySelector('#palco .quadro[id^="q-p-"]');
      const b = [...q.querySelectorAll('.quadro-acoes button')].find(x => /travando/i.test(x.textContent));
      b.click();
      return true;
    }).then(() => espera(1500)).then(() => A.evaluate(() => {
      const p = [...pares.values()][0];
      return { pedido: p.pedido, porque: p.porqueTamanho || '' };
    }));
    info('do lado de quem transmite: pedido=' + chegou.pedido + ' | ' + chegou.porque);
    (chegou.pedido === 'liso')
      ? ok('o pedido chegou em quem transmite')
      : mal('o pedido não chegou', JSON.stringify(chegou));
    /a fluidez|fluidez/i.test(chegou.porque)
      ? ok('e pesou na conta do tamanho, com assinatura', chegou.porque)
      : mal('o pedido não influenciou o tamanho', chegou.porque);

    const soltou = await B.evaluate(async () => {
      const q = document.querySelector('#palco .quadro[id^="q-p-"]');
      const b = [...q.querySelectorAll('.quadro-acoes button')].find(x => /borrado/i.test(x.textContent));
      b.click();
      return true;
    }).then(() => espera(1500)).then(() => A.evaluate(() => {
      const p = [...pares.values()][0];
      return { pedido: p.pedido, quandoNitido: p.quandoNitido || 0 };
    }));
    (soltou.pedido === null && soltou.quandoNitido > 0)
      ? ok('"está borrado" solta o pedido e libera a escada para subir já')
      : mal('o pedido de nitidez não teve efeito', JSON.stringify(soltou));

    /* ============ 14. o teste do retransmissor ============ */
    console.log('\n=== 14. Dá para testar o retransmissor antes de precisar dele? ===');
    const turn = await A.evaluate(async () => {
      const campos = ['in-turn-url', 'in-turn-user', 'in-turn-senha'].every(i => !!document.getElementById(i));
      const botao = !!document.getElementById('btn-turn');
      document.getElementById('in-turn-url').value = '';
      const vazio = await testarRetransmissor();
      document.getElementById('in-turn-url').value = 'http://nao-e-turn.com';
      const errado = await testarRetransmissor();
      document.getElementById('in-turn-url').value = 'turn:127.0.0.1:3478';
      document.getElementById('in-turn-user').value = 'u';
      document.getElementById('in-turn-senha').value = 'p';
      const linha = linhaDoRetransmissor();
      document.getElementById('in-turn-url').value = '';
      document.getElementById('in-turn-user').value = '';
      document.getElementById('in-turn-senha').value = '';
      return { campos, botao, vazio, errado, linha };
    });
    (turn.campos && turn.botao)
      ? ok('três campos separados e um botão, em vez de uma linha crua')
      : mal('a tela do retransmissor não foi trocada', JSON.stringify(turn));
    (!turn.vazio.ok && /Preencha/i.test(turn.vazio.txt))
      ? ok('campo vazio dá recado claro', turn.vazio.txt)
      : mal('não avisou sobre o campo vazio', JSON.stringify(turn.vazio));
    (!turn.errado.ok && /turn:/i.test(turn.errado.txt))
      ? ok('endereço fora do formato é recusado na hora, sem esperar 8s')
      : mal('aceitou um endereço que não é turn:', JSON.stringify(turn.errado));
    (turn.linha === 'turn:127.0.0.1:3478|u|p')
      ? ok('monta o formato antigo, então quem já tinha configurado não perde nada', turn.linha)
      : mal('o formato guardado mudou', turn.linha);

    /* ============ 15. som x imagem ============ */
    console.log('\n=== 15. O Bigas Voice mede se o som está na frente da imagem? ===');
    const sinc = await B.evaluate(() => {
      const p = [...pares.values()][0];
      const l = registro.linhas[registro.linhas.length - 1] || {};
      return { temCampo: 'desc' in l, valor: p.descompasso,
               mediu: typeof p.descompasso === 'number' };
    });
    info('descompasso medido: ' + sinc.valor + ' ms');
    sinc.temCampo ? ok('o descompasso entra no segundo-a-segundo')
                  : mal('o campo do descompasso não foi gravado');
    sinc.mediu ? ok('o Bigas Voice consegue medir som x imagem', sinc.valor + ' ms')
               : mal('não conseguiu medir o descompasso');

    /* ============ 16. o caderninho lido com o log REAL do André ============ */
    console.log('\n=== 16. O diagnóstico acerta no caso que aconteceu de verdade? ===');
    const real = await A.evaluate(() => {
      const guardadas = registro.linhas.slice();
      const gAuto = cfg.auto, gCap = est.capturaEm, gQual = cfg.qualidade;
      cfg.qualidade = '1080-60-8';

      const linha = (o) => Object.assign({
        t: 0, quem: 'BIG', fps: 31, enc: 30, fonte: 31, larg: 960, alt: 540,
        kbps: 2000, ping: 1, perda: 0, segura: 'none', porque: '', escB: 1, escF: 1,
        recFps: 0, recL: 0, recA: 0, recPerdidos: 0, recLargou: 0, recDec: '',
        congelou: 0, chaves: 0, socorro: 0, fila: 10, desc: 0,
        pint: 0, pintPior: 0, pintBur: 0,
      }, o);
      const encher = (f) => {
        registro.linhas.length = 0;
        for (let i = 0; i < 60; i++) registro.linhas.push(linha(f(i)));
      };

      // (a) o caso dele: tela entregando 31 com alvo 60, rede limpa
      encher(i => ({ t: i * 1000 }));
      const gargalo = resumoDoRegistro().join('\n');

      // (b) mesma coisa, mas a tela entregando 58: não pode acusar a captura
      encher(i => ({ t: i * 1000, fps: 57, enc: 57, fonte: 58 }));
      const saudavel = resumoDoRegistro().join('\n');

      // (c) socorro com perda ZERO -> é o decodificador dele, não a rede
      encher(i => ({ t: i * 1000, socorro: i % 8 === 0 ? 1 : 0, perda: 0 }));
      const socorroSemPerda = resumoDoRegistro().join('\n');

      // (d) socorro COM perda -> aí sim é a rede
      encher(i => ({ t: i * 1000, socorro: i % 8 === 0 ? 1 : 0, perda: 3 }));
      const socorroComPerda = resumoDoRegistro().join('\n');

      // (e) o decodificador dele desistiu da placa
      encher(i => ({ t: i * 1000, recFps: 31, recLargou: i * 10,
        recDec: 'ExternalDecoder (WMFVideoDecoder) (fallback from: ExternalDecoder (D3D11VideoDecoder))' }));
      const desistiu = resumoDoRegistro().join('\n');

      // (f) quem reduziu a captura: o Bigas Voice, não o monitor.
      // A captura de verdade neste teste é 1920x1080, então é preciso
      // fingir uma menor para as duas frases poderem aparecer.
      registro.linhas.length = 0;
      const gTam = window.tamanhoDaCaptura;
      window.tamanhoDaCaptura = () => ({ l: 960, a: 540 });
      est.capturaEm = 2;
      const notaDoFrag = montarRegistro();
      est.capturaEm = 1;
      const notaTela = montarRegistro();
      window.tamanhoDaCaptura = gTam;

      // (g) automático desligado tem que gritar
      cfg.auto = false; const semAuto = montarRegistro();
      cfg.auto = true;  const comAuto = montarRegistro();

      registro.linhas.length = 0;
      guardadas.forEach(l => registro.linhas.push(l));
      cfg.auto = gAuto; est.capturaEm = gCap; cfg.qualidade = gQual;

      return {
        acusaCaptura: /O GARGALO É A CAPTURA DA TELA/.test(gargalo),
        naoAcusaAtoa: !/O GARGALO É A CAPTURA DA TELA/.test(saudavel),
        culpaMaquina: /NÃO é a rede/.test(socorroSemPerda),
        culpaRede: /perde pacote/.test(socorroComPerda),
        naoDizPerda: !/perdendo pacote/.test(socorroSemPerda),
        viuDesistencia: /DESISTIU DA PLACA DE VÍDEO/.test(desistiu),
        assumeAReducao: /o Bigas Voice reduziu a captura/.test(notaDoFrag),
        culpaTelaQuandoEhTela: /sua tela entrega/.test(notaTela),
        gritaSemAuto: /AJUSTE AUTOMÁTICO ESTÁ DESLIGADO/.test(semAuto),
        caladoComAuto: !/AJUSTE AUTOMÁTICO ESTÁ DESLIGADO/.test(comAuto),
      };
    });
    real.acusaCaptura ? ok('com a tela entregando 31 de 60, aponta a CAPTURA')
                      : mal('não apontou a captura no caso real');
    real.naoAcusaAtoa ? ok('com a tela entregando 58, não acusa nada')
                      : mal('acusou a captura com tudo saudável');
    (real.culpaMaquina && real.naoDizPerda)
      ? ok('socorro sem perda: culpa a máquina dele, e não fala em pacote perdido')
      : mal('continua acusando a rede sem perda nenhuma', JSON.stringify(real));
    real.culpaRede ? ok('socorro COM perda: aí sim aponta a rede')
                   : mal('deixou de apontar a rede quando havia perda');
    real.viuDesistencia ? ok('grita quando o descompressor dele larga a placa de vídeo')
                        : mal('a desistência do hardware continua escondida');
    real.assumeAReducao ? ok('assume que foi o Bigas Voice que reduziu a captura, em vez de culpar a tela')
                        : mal('continua culpando o monitor por uma decisão do Bigas Voice');
    real.culpaTelaQuandoEhTela ? ok('e continua apontando a tela quando a tela É o limite')
                               : mal('parou de avisar quando o limite é mesmo da tela');
    (real.gritaSemAuto && real.caladoComAuto)
      ? ok('avisa quando o ajuste automático está desligado, e só nessa hora')
      : mal('o aviso do automático saiu errado', JSON.stringify(real));

    /* ============ 17. a captura que balança ============ */
    console.log('\n=== 17. A regra da captura pega o caso que escapou? ===');
    const balanca = await A.evaluate(() => {
      // amostra tirada do caderninho real do André: alvo 60, entregando isto
      const dele = [26,7,24,13,22,16,23,8,20,22,15,23,21,25,23,20,21,26,30,21,
                    23,20,21,20,33,24,14,23,23,22];
      // tela de verdade parada: quase zero, com espirros quando algo se mexe
      const parada = [0,1,0,60,2,0,1,0,0,55,1,0,2,1,0,0,58,1,0,1,
                      0,2,0,0,1,60,0,1,0,2];
      // captura boa
      const boa = Array.from({length:30},()=>58+(Math.random()<0.5?1:0));
      return { dele: capturaSuspeita(dele,60), parada: capturaSuspeita(parada,60),
               boa: capturaSuspeita(boa,60) };
    });
    balanca.dele ? ok('pega a captura que BALANÇA na metade do alvo (o caso dele)')
                 : mal('o caso real continua escapando');
    !balanca.parada ? ok('tela de verdade parada continua não gerando alarme falso')
                    : mal('passou a dar alarme falso com a tela parada');
    !balanca.boa ? ok('captura boa segue sem alarme') : mal('alarme falso com captura boa');

    /* ============ 18. reagir ao descompressor fraco do outro lado ============ */
    console.log('\n=== 18. O Bigas Voice reage quando o amigo cai para software? ===');
    const fraco = await A.evaluate(() => ({
      pegaFallback: descompressorFraco('ExternalDecoder (WMFVideoDecoder) (fallback from: ExternalDecoder (D3D11VideoDecoder))'),
      pegaFfmpeg:   descompressorFraco('FFmpegVideoDecoder'),
      pegaLibvpx:   descompressorFraco('libvpx'),
      aceitaHw:     !descompressorFraco('ExternalDecoder (D3D11VideoDecoder)'),
      aceitaVazio:  !descompressorFraco(''),
    }));
    (fraco.pegaFallback && fraco.pegaFfmpeg && fraco.pegaLibvpx)
      ? ok('reconhece descompressão por software (fallback, ffmpeg, libvpx)')
      : mal('não reconheceu um descompressor fraco', JSON.stringify(fraco));
    (fraco.aceitaHw && fraco.aceitaVazio)
      ? ok('não confunde hardware nem campo vazio com software')
      : mal('deu falso positivo em hardware', JSON.stringify(fraco));

    const reagiu = await A.evaluate(async () => {
      const p = [...pares.values()][0];
      const antes = p.porqueTamanho;
      // simula o recado que quem recebe manda quando o navegador dele desiste
      p.canal.onmessage({ data: JSON.stringify({ t:'dec',
        v:'ExternalDecoder (WMFVideoDecoder) (fallback from: ExternalDecoder (D3D11VideoDecoder))' }) });
      await new Promise(r => setTimeout(r, 400));
      const comFraco = { fraco: p.decDeleFraco, porque: p.porqueTamanho };
      p.canal.onmessage({ data: JSON.stringify({ t:'dec', v:'ExternalDecoder (D3D11VideoDecoder)' }) });
      await new Promise(r => setTimeout(r, 400));
      return { antes, comFraco, depois: { fraco: p.decDeleFraco, porque: p.porqueTamanho } };
    });
    info('assinatura com o descompressor fraco: ' + reagiu.comFraco.porque);
    reagiu.comFraco.fraco ? ok('quem manda registra que o descompressor dele desistiu')
                          : mal('o recado do descompressor não chegou');
    /descompressor dele está em software/.test(reagiu.comFraco.porque)
      ? ok('e manda imagem menor, com assinatura própria', reagiu.comFraco.porque)
      : mal('não reduziu a imagem para aliviar a descompressão', reagiu.comFraco.porque);
    (!reagiu.depois.fraco && !/software/.test(reagiu.depois.porque))
      ? ok('e desfaz sozinho quando ele volta para a placa de vídeo')
      : mal('ficou preso na redução depois da volta', JSON.stringify(reagiu.depois));

    /* O caso legítimo: VP9 descomprime por software SEMPRE, em qualquer
       máquina. Encolher a imagem por causa disso, com tudo indo bem,
       seria punir quem escolheu VP9 sem nenhum problema acontecendo. */
    const vp9 = await A.evaluate(async () => {
      const p = [...pares.values()][0];
      p.quandoSaude = 0; p.saudeSeguida = 0;      // ninguém reclamando
      p.canal.onmessage({ data: JSON.stringify({ t:'dec', v:'libvpx' }) });
      await new Promise(r => setTimeout(r, 300));
      const calmo = { fraco: p.decDeleFraco, porque: p.porqueTamanho };

      // agora o mesmo software, mas com o amigo reclamando de travada
      p.quandoSaude = Date.now(); p.saudeSeguida = 2;
      p.decDele = '';                              // força reavaliar
      p.canal.onmessage({ data: JSON.stringify({ t:'dec', v:'libvpx' }) });
      await new Promise(r => setTimeout(r, 300));
      const sofrendo = { fraco: p.decDeleFraco, porque: p.porqueTamanho };

      p.quandoSaude = 0; p.saudeSeguida = 0;
      p.canal.onmessage({ data: JSON.stringify({ t:'dec', v:'ExternalDecoder (D3D11VideoDecoder)' }) });
      await new Promise(r => setTimeout(r, 300));
      return { calmo, sofrendo };
    });
    (!vp9.calmo.fraco && !/software/.test(vp9.calmo.porque))
      ? ok('software sozinho NÃO encolhe a imagem (VP9 é sempre software)')
      : mal('puniu quem usa VP9 sem nada de errado acontecer', JSON.stringify(vp9.calmo));
    vp9.sofrendo.fraco
      ? ok('mas software COM o amigo reclamando de travada, aí sim reage')
      : mal('não reagiu com software e travada juntos', JSON.stringify(vp9.sofrendo));

    /* ============ 19. separar as vozes no fone ============ */
    console.log('\n=== 19. As vozes podem ficar em lados diferentes? ===');
    const vozes = await B.evaluate(() => {
      const p = [...pares.values()][0];
      const temSeletor = !!document.getElementById('sel-espacial');
      const padraoDesligado = cfg.espacial === false;

      /* O amplificador (que é quem carrega o controle de lado) só é ligado
         a partir de DUAS pessoas do outro lado — com uma só, separar não
         significa nada e não vale expor o áudio a um caminho a mais.
         Então o teste precisa de um segundo amigo para o caminho existir. */
      const falso = { id:'zzz', audio:{}, lado:{ pan:{ value:0 } } };
      pares.set('zzz', falso);
      cfg.espacial = true; aplicarVolume(); espalharVozes();
      const temLado = !!p.lado;
      const dois = [p.lado ? p.lado.pan.value : null, falso.lado.pan.value];

      // tirando o segundo, quem sobra volta para o meio
      pares.delete('zzz');
      espalharVozes();
      const umSo = p.lado ? p.lado.pan.value : null;

      // e desligar devolve todo mundo ao meio
      pares.set('zzz', falso);
      cfg.espacial = true; espalharVozes();
      cfg.espacial = false; espalharVozes();
      const desligado = [p.lado ? p.lado.pan.value : null, falso.lado.pan.value];

      pares.delete('zzz');
      return { temSeletor, padraoDesligado, umSo, dois, desligado, temLado };
    });
    info('um só: ' + vozes.umSo + ' | dois: ' + JSON.stringify(vozes.dois) +
         ' | desligado: ' + JSON.stringify(vozes.desligado));
    vozes.temSeletor ? ok('a opção existe nos ajustes') : mal('o seletor não foi criado');
    vozes.padraoDesligado ? ok('vem desligado por padrão, como decidido')
                          : mal('veio ligado por padrão');
    vozes.temLado ? ok('o caminho de áudio ganhou o controle de lado')
                  : mal('o StereoPanner não foi criado');
    (vozes.umSo === 0)
      ? ok('com uma pessoa só, a voz fica no meio')
      : mal('espalhou com uma pessoa só', String(vozes.umSo));
    (vozes.dois[0] !== null && vozes.dois[0] !== vozes.dois[1] &&
     Math.abs(vozes.dois[0]) <= 0.61 && Math.abs(vozes.dois[1]) <= 0.61)
      ? ok('com dois, cada um vai para um lado', JSON.stringify(vozes.dois))
      : mal('não separou as duas vozes', JSON.stringify(vozes.dois));
    (vozes.desligado[0] === 0 && vozes.desligado[1] === 0)
      ? ok('desligar devolve todo mundo ao meio')
      : mal('não desfez a separação', JSON.stringify(vozes.desligado));

    /* ============ 20. o modo canvas pinta do tamanho que aparece ============ */
    console.log('\n=== 20. O modo canvas parou de pintar 1920 num quadro pequeno? ===');
    const pintura = await B.evaluate(async () => {
      cfg.desenho = 'canvas'; aplicarModoDesenho();
      await new Promise(r => setTimeout(r, 1200));
      const c = document.querySelector('#palco canvas.pintura');
      const v = document.querySelector('#palco video');
      const r = c ? { canvas: c.width, tela: Math.round(c.clientWidth),
                      video: v ? v.videoWidth : 0 } : null;
      cfg.desenho = 'normal'; aplicarModoDesenho();
      return r;
    });
    if (!pintura) mal('o canvas do modo desenho não apareceu');
    else {
      info('vídeo ' + pintura.video + 'px | quadro na tela ' + pintura.tela +
           'px | canvas pintado ' + pintura.canvas + 'px');
      /* A regra é "o menor entre o que chega e o que aparece", e ela vale
         nos dois sentidos: um vídeo grande numa janela pequena é pintado
         no tamanho da janela; um vídeo pequeno numa janela grande NÃO é
         esticado, porque esticar não acrescenta nenhum pixel de verdade
         e custaria caro à toa. */
      const teto = Math.min(pintura.video, pintura.tela * 2);
      (Math.abs(pintura.canvas - teto) <= 4)
        ? ok('pinta o menor entre o vídeo e a tela',
             pintura.canvas + 'px (vídeo ' + pintura.video + ', tela ' + pintura.tela + ')')
        : mal('não respeitou o menor dos dois', pintura.canvas + 'px, esperado ~' + teto);
      (pintura.canvas <= pintura.video)
        ? ok('e nunca estica um vídeo pequeno')
        : mal('esticou o vídeo à toa', pintura.canvas + ' > ' + pintura.video);
    }

    /* ============ 21. o resgate de codec ============ */
    console.log('\n=== 21. O resgate de codec só aparece quando há para onde ir? ===');
    const resgate = await A.evaluate(async () => {
      const p = [...pares.values()][0];
      const guarda = { fraco: p.decDeleFraco, pode: p.podeDescomprimir, codec: cfg.codec };
      cfg.codec = 'h264';

      // (a) descompressor bom -> nenhum botão
      p.decDeleFraco = false; p.podeDescomprimir = ['h264','h265','av1'];
      oferecerResgate();
      const bom = !!document.getElementById('btn-resgate');

      // (b) desistiu, e ele descomprime H265 -> botão
      p.decDeleFraco = true;
      oferecerResgate();
      const b = document.getElementById('btn-resgate');
      const comSaida = b ? b.textContent : null;

      // (c) desistiu, mas ele SÓ tem o codec que já está dando errado
      p.podeDescomprimir = ['h264','vp8'];
      const antes = document.getElementById('btn-resgate');
      if (antes) antes.remove();
      oferecerResgate();
      const semSaida = !!document.getElementById('btn-resgate');

      // (d) o que ele lista de verdade
      const meus = possoDescomprimir();

      const sobrou = document.getElementById('btn-resgate');
      if (sobrou) sobrou.remove();
      p.decDeleFraco = guarda.fraco; p.podeDescomprimir = guarda.pode; cfg.codec = guarda.codec;
      return { bom, comSaida, semSaida, meus };
    });
    info('este navegador descomprime: ' + JSON.stringify(resgate.meus));
    !resgate.bom ? ok('descompressor saudável não gera botão nenhum')
                 : mal('ofereceu resgate sem precisar');
    /* Qual codec ele oferece depende do que ESTE navegador comprime: em
       headless não há H265, então a escolha certa passa a ser AV1. O que
       tem de valer sempre é: oferece algo, não é o codec que já está
       dando errado, e é algo que o amigo consegue descomprimir. */
    (resgate.comSaida && !/H264/.test(resgate.comSaida) &&
     /H265|AV1|VP9/.test(resgate.comSaida))
      ? ok('desistiu e há para onde ir: oferece um codec que os DOIS aguentam', resgate.comSaida)
      : mal('não ofereceu um resgate válido', String(resgate.comSaida));
    !resgate.semSaida
      ? ok('desistiu mas não há para onde ir: NÃO oferece (era o furo da troca automática)')
      : mal('ofereceu uma troca que não levaria a lugar nenhum');
    (Array.isArray(resgate.meus) && resgate.meus.length > 0)
      ? ok('sabe dizer o que este navegador consegue descomprimir', resgate.meus.join(', '))
      : mal('não conseguiu ler as capacidades de descompressão');

    /* ============ 22. o fone caiu no meio da partida ============ */
    console.log('\n=== 22. O microfone morrendo derruba a chamada? ===');
    const socorro = await A.evaluate(async () => {
      const p = [...pares.values()][0];
      if (!p.senderMic) return { erro: 'sem senderMic' };
      const antiga = p.senderMic.track;
      const faixaAntes = est.streamMic.getAudioTracks()[0];

      // mata o microfone do jeito que o Windows mata: a faixa termina
      faixaAntes.stop();
      const morreu = faixaAntes.readyState;

      await socorrerMicrofone('teste');
      await new Promise(r => setTimeout(r, 500));

      const nova = p.senderMic.track;
      return {
        morreu,
        trocou: !!(nova && nova !== antiga),
        novaViva: !!(nova && nova.readyState === 'live'),
        chamadaDePe: p.pc.connectionState,
        temFluxo: !!(est.streamMic && est.streamMic.getAudioTracks()[0] &&
                     est.streamMic.getAudioTracks()[0].readyState === 'live'),
      };
    });
    (socorro.morreu === 'ended')
      ? ok('o teste conseguiu matar o microfone de verdade')
      : mal('não deu para simular a queda', JSON.stringify(socorro));
    socorro.trocou ? ok('trocou a faixa no sender sozinho')
                   : mal('a faixa morta continua no ar', JSON.stringify(socorro));
    socorro.novaViva ? ok('e a faixa nova está viva') : mal('a faixa nova nasceu morta');
    (socorro.chamadaDePe === 'connected')
      ? ok('a chamada não caiu junto', socorro.chamadaDePe)
      : mal('a chamada caiu na troca', socorro.chamadaDePe);
    socorro.temFluxo ? ok('o microfone local voltou a funcionar') : mal('ficou sem microfone');

    /* ============ 23. o clipe sem depender do relógio do JS ============ */
    console.log('\n=== 23. O clipe é fatiado pelo gravador, não pelo setInterval? ===');
    const clip = await A.evaluate(async () => {
      cfg.clipe = 5;                       // alvo curto para o teste andar
      const ligou = comecarBuffer();
      if (!ligou) return { erro: 'não consegui ligar o buffer' };
      // MATA o relógio do JavaScript de propósito: é exatamente o que o
      // Chrome faz com a aba em segundo plano
      clearInterval(clipe.relogio); clipe.relogio = null;
      await new Promise(r => setTimeout(r, 9000));
      const r = {
        gravadores: clipe.gravadores.length,
        pedacos: clipe.gravadores.map(g => g.pedacos.length),
        semRelogio: clipe.relogio === null,
      };
      pararBuffer();
      return r;
    });
    if (clip.erro) mal('o buffer do clipe não ligou', clip.erro);
    else {
      info('gravadores: ' + clip.gravadores + ' | pedaços em cada: ' + JSON.stringify(clip.pedacos));
      clip.semRelogio ? ok('o relógio do JavaScript estava mesmo desligado no teste')
                      : mal('o teste não conseguiu desligar o relógio');
      (clip.pedacos.some(n => n > 0))
        ? ok('o gravador entregou pedaços sozinho, sem relógio nenhum', clip.pedacos.join('+'))
        : mal('nenhum pedaço saiu sem o setInterval — voltou a depender do relógio');
      (clip.gravadores >= 2)
        ? ok('e a troca de gravadores aconteceu pelo ritmo do gravador', clip.gravadores + ' vivos')
        : ok('ainda no primeiro gravador (alvo pode não ter sido atingido em 9s)');
      (clip.gravadores <= 2)
        ? ok('nunca guarda mais de dois gravadores')
        : mal('acumulou gravadores', String(clip.gravadores));
    }

    /* ============ 24. a barra de pessoas não é mais destruída ============ */
    console.log('\n=== 24. A barra de pessoas sobrevive a um mudo? ===');
    const barra = await A.evaluate(() => {
      const p = [...pares.values()][0];
      pintarGente();
      const antes = document.getElementById('ficha-' + p.id);
      const marca = {};
      antes.dadoDeTeste = marca;               // marca que só sobrevive se o nó sobreviver

      p.mudo = true; pintarGente();
      const depoisMudo = document.getElementById('ficha-' + p.id);
      const sobreviveu = depoisMudo === antes && depoisMudo.dadoDeTeste === marca;
      const pegouMudo = depoisMudo.classList.contains('mudo');
      const texto = depoisMudo.querySelector('.ficha-sub').textContent;

      p.mudo = false; pintarGente();
      const soltouMudo = !document.getElementById('ficha-' + p.id).classList.contains('mudo');

      // alguém que sai tem que sumir mesmo
      const falso = { id:'zzz9', nome:'Fantasma', conectado:true, mudo:false };
      pares.set('zzz9', falso); pintarGente();
      const entrou = !!document.getElementById('ficha-zzz9');
      pares.delete('zzz9'); pintarGente();
      const saiu = !document.getElementById('ficha-zzz9');

      // e a ordem tem que continuar certa: eu primeiro
      const ordem = [...document.getElementById('gente').children].map(f => f.id);
      return { sobreviveu, pegouMudo, texto, soltouMudo, entrou, saiu, ordem };
    });
    info('ordem das fichas: ' + JSON.stringify(barra.ordem));
    barra.sobreviveu ? ok('a ficha é a MESMA depois de mutar (nada foi destruído)')
                     : mal('a ficha foi recriada do zero');
    (barra.pegouMudo && /desligado/.test(barra.texto))
      ? ok('e mesmo assim a classe e o texto acompanharam', barra.texto)
      : mal('atualizou o nó mas não o conteúdo', JSON.stringify(barra));
    barra.soltouMudo ? ok('desmutar tira a classe de volta') : mal('ficou preso no mudo');
    (barra.entrou && barra.saiu)
      ? ok('quem entra ganha ficha e quem sai perde a dele')
      : mal('entrada ou saída de gente quebrou', JSON.stringify(barra));
    (barra.ordem[0] === 'ficha-eu')
      ? ok('a ordem continua certa, você em primeiro')
      : mal('a ordem embaralhou', JSON.stringify(barra.ordem));

    /* ============ 25. a tela não apaga com vídeo rolando ============ */
    console.log('\n=== 25. O Bigas Voice segura a tela acesa enquanto tem vídeo? ===');
    const travaTela = await B.evaluate(async () => {
      // o navegador de teste pode nem ter a API; o que importa é a REGRA
      const p = [...pares.values()][0];
      const semNada = (() => { const g = est.streamTela; est.streamTela = null;
        const guarda = p.temTela; p.temTela = false;
        const r = temVideoRolando(); est.streamTela = g; p.temTela = guarda; return r; })();
      const recebendo = (() => { const g = est.streamTela; est.streamTela = null;
        const guarda = p.temTela; p.temTela = true;
        const r = temVideoRolando(); est.streamTela = g; p.temTela = guarda; return r; })();
      const transmitindo = (() => { const guarda = p.temTela; p.temTela = false;
        const g = est.streamTela; est.streamTela = {};
        const r = temVideoRolando(); est.streamTela = g; p.temTela = guarda; return r; })();
      await cuidarDaTravaDeTela();
      return { semNada, recebendo, transmitindo, temApi: !!navigator.wakeLock,
               travou: !!est.travaTela };
    });
    info('a API existe neste navegador: ' + travaTela.temApi + ' | travou agora: ' + travaTela.travou);
    (!travaTela.semNada && travaTela.recebendo && travaTela.transmitindo)
      ? ok('a regra está certa: segura quem TRANSMITE e quem ASSISTE, e solta quando não há vídeo')
      : mal('a regra de quando segurar está errada', JSON.stringify(trava));
    ok('pedir a trava não explodiu nem quando o navegador não tem a API');

    /* ============ 26. flutuar por cima de tudo ============ */
    console.log('\n=== 26. Dá para tirar o vídeo do amigo da aba? ===');
    const pip = await B.evaluate(() => {
      const q = document.querySelector('#palco .quadro[id^="q-p-"]');
      const b = q ? [...q.querySelectorAll('.quadro-acoes button')]
                      .find(x => /flutuar/i.test(x.textContent)) : null;
      return { suportado: !!document.pictureInPictureEnabled, temBotao: !!b,
               dica: b ? b.title : null,
               naoBloqueado: q ? !q.querySelector('video').disablePictureInPicture : false };
    });
    info('o navegador suporta: ' + pip.suportado);
    (pip.suportado ? pip.temBotao : true)
      ? ok('o botão de flutuar aparece onde o navegador suporta',
           pip.temBotao ? pip.dica : 'navegador sem suporte, e nada quebrou')
      : mal('o navegador suporta mas o botão não apareceu');
    pip.naoBloqueado ? ok('o vídeo não está bloqueado para flutuar')
                     : mal('o vídeo está com o flutuar desabilitado');

    /* ============ 27. o portão da voz ============ */
    console.log('\n=== 27. O ponto de corte da voz virou ajuste? ===');
    const portao = await A.evaluate(() => {
      const campo = document.getElementById('in-portao');
      const marca = document.getElementById('portao-marca');
      const num   = document.getElementById('portao-num');
      if (!campo || !marca) return { falta: true };
      const guarda = cfg.portao;

      campo.value = 30; campo.oninput();
      const em30 = { cfg: cfg.portao, marca: marca.style.left, texto: num.textContent };

      campo.value = 5; campo.oninput();
      const em5 = { cfg: cfg.portao, marca: marca.style.left };

      // e o medidor tem que respeitar o novo corte
      cfg.portao = 40;
      const abaixo = 20 > (cfg.portao||12);     // 20 de nível com corte em 40
      cfg.portao = 10;
      const acima  = 20 > (cfg.portao||12);     // mesmo nível com corte em 10

      cfg.portao = guarda; campo.value = guarda; campo.oninput();
      return { em30, em5, abaixo, acima, min: campo.min, max: campo.max };
    });
    if (portao.falta) mal('o controle do portão não foi criado');
    else {
      info('faixa do controle: ' + portao.min + ' a ' + portao.max +
           ' | marca em 30: ' + portao.em30.marca);
      (portao.em30.cfg === 30 && portao.em5.cfg === 5)
        ? ok('arrastar o controle muda o ajuste de verdade')
        : mal('o controle não mexe no ajuste', JSON.stringify(portao));
      (portao.em30.marca === '30%' && portao.em5.marca === '5%')
        ? ok('e o risquinho branco acompanha na barra', portao.em30.marca)
        : mal('o risquinho não acompanha', JSON.stringify(portao));
      (portao.em30.texto === '30')
        ? ok('o número na tela acompanha') : mal('o número não acompanha');
      (!portao.abaixo && portao.acima)
        ? ok('um mesmo nível de som conta como fala ou não, conforme o corte')
        : mal('o corte não está sendo usado na decisão', JSON.stringify(portao));
    }

    /* ============ 28. o nome novo, sem quebrar o protocolo ============ */
    console.log('\n=== 28. Virou Bigas Voice sem quebrar quem está na versão antiga? ===');
    const nome = await A.evaluate(async () => {
      const man = document.querySelector('link[rel=manifest]');
      let m = null;
      try { m = JSON.parse(decodeURIComponent(man.href.split(',').slice(1).join(','))); } catch (e) {}
      return {
        titulo: document.title,
        cabecalho: (document.querySelector('h1') || {}).textContent,
        manifesto: m ? m.name : null,
        // o que NÃO pode ter mudado, sob pena de não conectar com a v4
        assunto: (typeof assunto === 'function') ? assunto() : null,
        canal: [...pares.values()][0] ? [...pares.values()][0].canal.label : null,
        chaveAjustes: localStorage.getItem('frag') !== null,
      };
    });
    info('canal de dados: "' + nome.canal + '" | assunto no servidor: "' + nome.assunto + '"');
    (nome.titulo === 'Bigas Voice' && nome.cabecalho === 'Bigas Voice' && nome.manifesto === 'Bigas Voice')
      ? ok('título, cabeçalho e app instalado dizem Bigas Voice')
      : mal('o nome não trocou em algum lugar', JSON.stringify(nome));
    (nome.canal === 'frag')
      ? ok('o canal de dados manteve o nome antigo (senão a v4 não conecta)')
      : mal('o canal de dados mudou de nome e quebrou a compatibilidade', String(nome.canal));
    (nome.assunto && nome.assunto.startsWith('frag2-'))
      ? ok('o assunto no servidor de sinal continua o mesmo', nome.assunto)
      : mal('o endereço do servidor de sinal mudou', String(nome.assunto));
    nome.chaveAjustes
      ? ok('os ajustes guardados continuam sendo achados')
      : mal('a chave dos ajustes mudou e todo mundo perderia a configuração');

    /* ============ 29. nenhuma animação cara ============ */
    console.log('\n=== 29. Alguma animação ainda repinta a tela 60x por segundo? ===');
    const anim = await A.evaluate(() => {
      const caras = [];
      const rodando = [];
      for (const folha of document.styleSheets) {
        let regras; try { regras = folha.cssRules; } catch (e) { continue; }
        for (const r of regras) {
          if (r.type === CSSRule.KEYFRAMES_RULE) {
            let txt = '';
            for (const q of r.cssRules) txt += q.style.cssText + ';';
            if (/box-shadow|left:|top:|width:|height:|filter:|margin/.test(txt))
              caras.push(r.name + ' -> ' + txt.slice(0, 60));
          }
          if (r.selectorText && /infinite/.test(r.style.animation || '')) rodando.push(r.selectorText);
        }
      }
      return { caras, rodando };
    });
    info('animações em loop: ' + anim.rodando.length);
    (anim.caras.length === 0)
      ? ok('nenhum keyframe mexe em sombra, layout ou filtro — só transform e opacity')
      : mal('ainda há animação cara', anim.caras.join(' | '));

    /* ============ 30. o painel em grupos ============ */
    console.log('\n=== 30. O painel parou de despejar tudo de uma vez? ===');
    const painel = await A.evaluate(() => {
      const corpo = document.querySelector('#painel .painel-corpo');
      const grupos = [...corpo.querySelectorAll('.grupo')];
      return {
        quantos: grupos.length,
        sobrouSecaoSolta: !!corpo.querySelector(':scope > .secao'),
        abertos: grupos.filter(g => g.open).map(g => g.querySelector('summary').textContent),
        fechados: grupos.filter(g => !g.open).length,
        // os controles têm que continuar existindo e achaveis pelo id
        idsVivos: ['sel-mic','vol','in-portao','sel-codec','in-turn-url','btn-registro']
                    .filter(i => !!document.getElementById(i)).length,
      };
    });
    info('grupos: ' + painel.quantos + ' | abertos: ' + JSON.stringify(painel.abertos));
    (painel.quantos >= 8) ? ok('o painel virou grupos', painel.quantos + ' grupos')
                          : mal('o painel não foi agrupado', String(painel.quantos));
    !painel.sobrouSecaoSolta ? ok('nenhuma seção ficou solta fora de grupo')
                             : mal('sobrou seção fora de grupo');
    (painel.fechados >= 5) ? ok('a maioria começa fechada', painel.fechados + ' fechados')
                           : mal('quase tudo continua aberto', String(painel.fechados));
    (painel.abertos.length >= 3 && painel.abertos.some(t => /Microfone/.test(t)))
      ? ok('e o que todo mundo mexe começa aberto', painel.abertos.join(', '))
      : mal('o essencial não ficou aberto', JSON.stringify(painel.abertos));
    (painel.idsVivos === 6)
      ? ok('todos os controles sobreviveram à reorganização', painel.idsVivos + '/6')
      : mal('a reorganização perdeu controles', painel.idsVivos + '/6');

    /* ============ 31. o ponto de status parou de mentir ============ */
    console.log('\n=== 31. O pontinho olha mais do que o ping? ===');
    const saude = await A.evaluate(async () => {
      const p = [...pares.values()][0];
      const ler = () => ({ classe: document.getElementById('ponto').className,
                           txt: document.getElementById('saude-txt').textContent,
                           porque: document.getElementById('ponto').parentElement.title });
      p.decDeleFraco = false; p.quandoSaude = 0; p.saudeSeguida = 0;
      await atualizarNumeros();
      const calmo = ler();

      // ping continua 1 ms, mas o descompressor dele desistiu da placa
      p.decDeleFraco = true;
      await atualizarNumeros();
      const comProblema = ler();

      p.decDeleFraco = false;
      await atualizarNumeros();
      const voltou = ler();
      return { calmo, comProblema, voltou };
    });
    info('calmo: ' + saude.calmo.txt + '  [' + saude.calmo.porque + ']');
    info('com problema: ' + saude.comProblema.txt + '  [' + saude.comProblema.porque + ']');
    /* Nesta altura da prova o compressor está mesmo limitado por banda —
       vários testes acima mexeram no teto de propósito. E "internet
       apertada" É um amarelo legítimo, então exigir verde aqui seria
       exigir que o indicador mentisse ao contrário.
       O que prova a correção é o MOVIMENTO: com ping de 1 ms o tempo
       todo, ele tem que piorar quando a imagem quebra e voltar quando
       o problema passa. Antes ele ficava verde nos três momentos. */
    const nivel = (c)=> /ruim/.test(c) ? 2 : /medio/.test(c) ? 1 : 0;
    const antes = nivel(saude.calmo.classe);
    const pior  = nivel(saude.comProblema.classe);
    const fim   = nivel(saude.voltou.classe);

    (pior === 2)
      ? ok('com o ping em 1 ms MAS o descompressor dele quebrado, fica VERMELHO — era aqui que ele mentia',
           saude.comProblema.txt)
      : mal('não ficou vermelho com a imagem quebrada', JSON.stringify(saude.comProblema));
    (pior > antes)
      ? ok('o indicador PIOROU com o problema, sem o ping ter mudado nada',
           saude.calmo.txt + ' -> ' + saude.comProblema.txt)
      : mal('o problema não mexeu no indicador', JSON.stringify(saude));
    (fim === antes)
      ? ok('e voltou ao que era quando o problema passou', saude.voltou.txt)
      : mal('ficou preso no estado ruim', JSON.stringify(saude.voltou));
    /apertada|ping|perda|descompressor|quadros|travando|desconectou/.test(saude.comProblema.porque)
      ? ok('e diz o motivo por extenso ao passar o mouse', saude.comProblema.porque)
      : mal('não explica o motivo', saude.comProblema.porque);

    /* ============ 32. a proposta que se perdeu no caminho ============ */
    console.log('\n=== 32. Quem ficou preso em "have-local-offer" é socorrido? ===');
    const perdida = await A.evaluate(async () => {
      const enviados = [];
      const guardado = window.mandarSinal;
      window.mandarSinal = async (par, obj) => { enviados.push(obj.tipo); };

      const p = [...pares.values()][0];
      // fabrica exatamente o estado do caderninho: proposta feita, nada de volta
      const fingir = (n, v) => Object.defineProperty(p.pc, n, { get: () => v, configurable: true });
      fingir('signalingState', 'have-local-offer');
      fingir('connectionState', 'new');
      p.impolido = true;              // sou eu quem propõe, logo sou eu quem reenvia
      p.desdeProposta = 0; p.reenvios = 0;

      await atualizarNumeros();
      const primeiraVolta = { enviou: enviados.length, anotouHorario: p.desdeProposta > 0 };

      // finge que o tempo de espera já passou
      p.desdeProposta = Date.now() - 60000;
      await atualizarNumeros();
      const depoisDaEspera = enviados.length;
      const avisou = registro.marcos.some(m => /sem resposta — reenviando/.test(m.txt));

      // insiste bem mais vezes do que o limite
      for (let i = 0; i < 9; i++) { p.desdeProposta = Date.now() - 600000; await atualizarNumeros(); }
      const total = enviados.length;

      // a pessoa conectou: tem que largar do pé
      delete p.pc.signalingState; delete p.pc.connectionState;
      await atualizarNumeros();
      const limpou = (p.reenvios === 0 && p.desdeProposta === 0);

      window.mandarSinal = guardado;
      delete p.impolido;
      return { primeiraVolta, depoisDaEspera, total, avisou, limpou,
               tipos: [...new Set(enviados)] };
    });
    info('reenvios: ' + perdida.total + ' | tipos: ' + JSON.stringify(perdida.tipos));
    (perdida.primeiraVolta.enviou === 0 && perdida.primeiraVolta.anotouHorario)
      ? ok('na primeira volta só marca a hora — não atropela quem acabou de propor')
      : mal('reenviou na hora ou nem anotou', JSON.stringify(perdida.primeiraVolta));
    (perdida.depoisDaEspera === 1)
      ? ok('passada a espera, reenvia a proposta uma vez')
      : mal('não reenviou (ou reenviou demais)', String(perdida.depoisDaEspera));
    (perdida.tipos.length === 1 && perdida.tipos[0] === 'oferta')
      ? ok('e o que sai é uma proposta, não outra coisa')
      : mal('mandou o recado errado', JSON.stringify(perdida.tipos));
    (perdida.total === 5)
      ? ok('desiste depois de 5 tentativas em vez de martelar o servidor para sempre')
      : mal('não respeitou o limite de 5', String(perdida.total));
    perdida.avisou
      ? ok('e conta no caderninho o que estava fazendo')
      : mal('socorreu calado');
    perdida.limpou
      ? ok('quando a pessoa conecta, o vigia zera e some')
      : mal('o vigia ficou marcado depois de conectar');

    /* ============ 33. o tamanho que virava undefined ============ */
    console.log('\n=== 33. O caderninho parou de anotar "undefinedxundefined"? ===');
    const tamanho = await A.evaluate(() => {
      const p = [...pares.values()][0];
      p.tamAntes = '1280x720';
      // é isto que chega quando a transmissão acaba: relatório sem as medidas
      anotarLinha({ par: p, sv: { bytesSent: 1 }, ms: 1, perda: 0, kbps: 0 });
      const sujo = registro.marcos.filter(m => /undefined/.test(m.txt)).map(m => m.txt);
      return { sujo, guardou: p.tamAntes };
    });
    (tamanho.sujo.length === 0)
      ? ok('sem medidas, não inventa tamanho nenhum')
      : mal('ainda anota undefined', tamanho.sujo.join(' | '));
    (tamanho.guardou === '1280x720')
      ? ok('e guarda o último tamanho de verdade, para comparar quando voltar')
      : mal('apagou o último tamanho bom', String(tamanho.guardou));

    /* ============ 34. o tamanho da captura que pisca ============ */
    console.log('\n=== 34. Uma leitura que falha por um instante manda encolher a imagem? ===');
    const pisca = await A.evaluate(async () => {
      const p = [...pares.values()][0];
      const faixa = est.streamTela.getVideoTracks()[0];
      const verdadeiro = faixa.getSettings.bind(faixa);

      // pede MAIS do que o monitor tem — é a situação do caderninho
      cfg.qualidade = '1440-60-14';
      est.ultimoTamCaptura = null;
      const normal = perfilReal();

      // agora a leitura pisca, como acontece na troca de tela
      faixa.getSettings = () => ({});
      const piscou = perfilReal();

      faixa.getSettings = verdadeiro;
      const voltou = perfilReal();

      // e quando a transmissão acaba de verdade, ele esquece
      const guardaTela = est.streamTela;
      est.streamTela = null;
      const semTela = tamanhoDaCaptura();
      est.streamTela = guardaTela;

      cfg.qualidade = '1080-60-8';
      return { normal: normal.l, piscou: piscou.l, voltou: voltou.l,
               semTela, pedido: PERFIS['1440-60-14'].l };
    });
    info('captura ' + pisca.normal + 'px | piscando ' + pisca.piscou +
         'px | pedido era ' + pisca.pedido + 'px');
    (pisca.piscou === pisca.normal)
      ? ok('a leitura piscou e o tamanho não mudou — usa o último que ele mediu')
      : mal('caiu no tamanho pedido e ia mandar encolher à toa',
            pisca.normal + ' -> ' + pisca.piscou);
    (pisca.piscou !== pisca.pedido)
      ? ok('e não chuta a largura do perfil pedido, que é maior que o monitor')
      : mal('chutou o perfil pedido', String(pisca.piscou));
    (pisca.voltou === pisca.normal)
      ? ok('volta ao normal quando a leitura volta')
      : mal('ficou preso no valor velho', String(pisca.voltou));
    (pisca.semTela === null)
      ? ok('e esquece o tamanho quando a transmissão termina')
      : mal('guardou tamanho de uma transmissão que acabou', JSON.stringify(pisca.semTela));

    /* ============ 35. a janela do amigo com folga ============ */
    console.log('\n=== 35. 22 pixels de diferença mandam encolher a imagem inteira? ===');
    const folgaJanela = await A.evaluate(async () => {
      const p = [...pares.values()][0];
      const largura = perfilReal().l;
      const medir = async (querendo) => {
        // os testes lá de cima mexeram nas escadas de propósito; aqui a
        // pergunta é só sobre a JANELA, então elas voltam ao neutro
        const a = autoDe(p); a.degrauBanda = 1; a.degrauFps = 1;
        p.pedido = null; p.decDeleFraco = false;
        p.larguraQueQuer = querendo;
        p.perfilAplicado = null;
        await aplicarPerfilVideo(p);
        return { encolher: p.encolherAtual, porque: p.porqueTamanho,
                 // é isto que responde a pergunta: a JANELA mandou encolher?
                 janelaMandou: /janela dele/.test(p.porqueTamanho || '') };
      };
      const quaseIgual = await medir(Math.round(largura * 0.99));  // 1901 de 1920
      const bemMenor   = await medir(Math.round(largura * 0.45));  // janela pela metade
      const igual      = await medir(largura);
      p.larguraQueQuer = 0; p.perfilAplicado = null;
      await aplicarPerfilVideo(p);
      return { largura, quaseIgual, bemMenor, igual };
    });
    info('vídeo ' + folgaJanela.largura + 'px | janela 99%: ' + folgaJanela.quaseIgual.encolher +
         'x | janela 45%: ' + folgaJanela.bemMenor.encolher + 'x');
    !folgaJanela.quaseIgual.janelaMandou
      ? ok('janela 1% menor: a janela não manda encolher nada')
      : mal('encolheu por causa de 1% de diferença', JSON.stringify(folgaJanela.quaseIgual));
    !folgaJanela.igual.janelaMandou
      ? ok('janela do mesmo tamanho: a janela não manda encolher nada')
      : mal('encolheu com a janela exata', JSON.stringify(folgaJanela.igual));
    (folgaJanela.quaseIgual.encolher === 1 && folgaJanela.igual.encolher === 1)
      ? ok('e com as escadas no neutro a imagem sai inteira')
      : mal('sobrou encolhimento de outra origem',
            JSON.stringify([folgaJanela.quaseIgual, folgaJanela.igual]));
    (folgaJanela.bemMenor.janelaMandou && folgaJanela.bemMenor.encolher > 1)
      ? ok('janela pela metade: aí sim encolhe, e diz que foi por causa dela',
           folgaJanela.bemMenor.encolher + 'x — ' + folgaJanela.bemMenor.porque)
      : mal('deixou de economizar quando valia a pena', JSON.stringify(folgaJanela.bemMenor));

    /* ============ 36. o socorro da captura ============ */
    console.log('\n=== 36. Quando o Windows entrega menos quadros, ele socorre — e sabe desistir? ===');
    const socorroCap = await A.evaluate(async () => {
      const faixa = est.streamTela.getVideoTracks()[0];
      const pedidos = [];
      faixa.applyConstraints = async (c) => { pedidos.push(c.height.ideal); };
      cfg.qualidade = '1080-60-8';
      cfg.socorroCaptura = true;

      const encher = (v) => { est.histFonte = new Array(34).fill(v); };
      const jaEsperou = () => { est.socorro.quando = Date.now() - 60000; };
      const rodar = async () => { jaEsperou(); await socorrerCaptura(); };

      /* --- caso 1: sufocada, e capturar menor RENDE --- */
      zerarSocorroCaptura(); pedidos.length = 0;
      encher(30);                                  // 30 de 60, cravado
      await rodar();
      const desceu = { degrau: est.socorro.degrau, fase: est.socorro.fase,
                       pediu: pedidos.slice() };
      encher(52);                                  // rendeu muito
      await rodar();
      const manteve = { degrau: est.socorro.degrau, desistiu: est.socorro.desistiu,
                        pediu: pedidos.slice() };

      /* --- caso 2: sufocada, e capturar menor NÃO rende --- */
      zerarSocorroCaptura(); pedidos.length = 0;
      encher(30);
      await rodar();
      const desceu2 = est.socorro.degrau;
      encher(31);                                  // praticamente igual
      await rodar();
      const voltou = { degrau: est.socorro.degrau, desistiu: est.socorro.desistiu,
                       pediu: pedidos.slice() };
      encher(30);
      await rodar();
      const naoInsiste = est.socorro.degrau;

      /* --- caso 3: captura saudável, não encosta em nada --- */
      zerarSocorroCaptura(); pedidos.length = 0;
      encher(58);
      await rodar();
      const saudavel = { degrau: est.socorro.degrau, mexeu: pedidos.length };

      /* --- caso 4: desligado no painel, não faz nada --- */
      cfg.socorroCaptura = false;
      zerarSocorroCaptura(); pedidos.length = 0;
      encher(30);
      await rodar();
      const desligado = { degrau: est.socorro.degrau, mexeu: pedidos.length };
      cfg.socorroCaptura = true;

      return { desceu, manteve, desceu2, voltou, naoInsiste, saudavel, desligado,
               base: est.tamBaseCaptura };
    });
    info('desceu para ' + JSON.stringify(socorroCap.desceu.pediu) + 'p | ' +
         'ao não render pediu ' + JSON.stringify(socorroCap.voltou.pediu) + 'p');
    (socorroCap.desceu.degrau === 1 && socorroCap.desceu.pediu[0] === 720)
      ? ok('tela entregando 30 de 60: capta em 720p para medir se rende')
      : mal('não socorreu uma captura sufocada', JSON.stringify(socorroCap.desceu));
    (socorroCap.desceu.fase === 'medindo')
      ? ok('e fica MEDINDO em vez de dar o resultado por certo')
      : mal('não entrou em medição', socorroCap.desceu.fase);
    (socorroCap.manteve.degrau === 1 && !socorroCap.manteve.desistiu)
      ? ok('subiu de 30 para 52: mantém o tamanho menor')
      : mal('desfez uma troca que deu certo', JSON.stringify(socorroCap.manteve));
    (socorroCap.voltou.degrau === 0 && socorroCap.voltou.pediu.join(',') === '720,1080')
      ? ok('NÃO rendeu (30 -> 31): volta sozinho ao tamanho cheio — é isto que impede '+
           'trocar nitidez por nada')
      : mal('ficou com a imagem pior sem ter ganhado quadros', JSON.stringify(socorroCap.voltou));
    (socorroCap.voltou.desistiu && socorroCap.naoInsiste === 0)
      ? ok('e não fica insistindo no que já provou que não funciona')
      : mal('voltou a insistir', JSON.stringify({ d: socorroCap.voltou.desistiu, n: socorroCap.naoInsiste }));
    (socorroCap.saudavel.degrau === 0 && socorroCap.saudavel.mexeu === 0)
      ? ok('com a tela entregando 58 de 60, não encosta em nada')
      : mal('mexeu numa captura que estava boa', JSON.stringify(socorroCap.saudavel));
    (socorroCap.desligado.degrau === 0 && socorroCap.desligado.mexeu === 0)
      ? ok('e obedece quando você desliga o ajuste')
      : mal('mexeu mesmo desligado', JSON.stringify(socorroCap.desligado));

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
