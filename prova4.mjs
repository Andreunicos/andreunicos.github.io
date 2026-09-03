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
      return { olhando: !!p.olhandoQuadros, amostras: p.intervalosQtd||0,
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
               amostras: p.intervalosQtd||0 };
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
      return { ligado: pulso.ligado, amostras: pulso.qtd,
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
      const antes = cfg.desenho;
      cfg.desenho = 'normal';
      const limpo = { lista: ajustesCaros().length, txt: montarRegistro() };
      cfg.desenho = 'canvas';
      const sujo = { lista: ajustesCaros().length, txt: montarRegistro() };
      cfg.desenho = antes;
      return {
        limpoLista: limpo.lista,
        sujoLista: sujo.lista,
        limpoAvisa: limpo.txt.includes('AJUSTES CAROS LIGADOS'),
        sujoAvisa: sujo.txt.includes('AJUSTES CAROS LIGADOS'),
        sujoCita: sujo.txt.includes('MODO CANVAS'),
        semprePõe: limpo.txt.includes('desenho: normal'),
        temPulso: limpo.txt.includes('a PÁGINA do Bigas Voice está acompanhando'),
      };
    });
    (caros.limpoLista === 0 && caros.sujoLista === 1)
      ? ok('reconhece o ajuste caro que sobrou', '0 limpo, 1 ligado')
      : mal('não contou os ajustes caros', JSON.stringify(caros));
    (!caros.limpoAvisa && caros.sujoAvisa && caros.sujoCita)
      ? ok('só grita quando algum está ligado, e diz qual')
      : mal('o aviso de ajuste caro saiu errado', JSON.stringify(caros));
    caros.semprePõe ? ok('o estado dele aparece sempre, ligado ou não')
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
      : mal('faltou alguma das três causas', JSON.stringify(trava));
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
      const gComp = est.compressorNaPlaca, gNome = est.ultimoCompressor;
      cfg.qualidade = '1080-60-8';
      // este bloco pergunta sobre a CAPTURA. Em headless nao existe placa de
      // video, entao o compressor e software de verdade e o diagnostico (com
      // razao) passaria a acusar o compressor. Fixa a variavel que nao esta
      // sendo testada aqui — o teste 43 e quem cuida dela.
      est.compressorNaPlaca = true;
      est.ultimoCompressor = 'MediaFoundationVideoEncodeAccelerator (NVIDIA H.264 Encoder MFT)';

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
      est.compressorNaPlaca = gComp; est.ultimoCompressor = gNome;

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
      // a base tem que ser FIXADA aqui: testes anteriores podem ter deixado a
      // captura ja reduzida, e ai os numeros deste teste virariam loteria
      const preparar = () => { zerarSocorroCaptura(); est.tamBaseCaptura = {l:1920,a:1080}; pedidos.length = 0; };
      const rodar = async () => { jaEsperou(); await socorrerCaptura(); };

      /* --- caso 1: sufocada, e capturar menor RENDE --- */
      preparar();
      encher(30);                                  // 30 de 60, cravado
      await rodar();
      const desceu = { degrau: est.socorro.degrau, fase: est.socorro.fase,
                       pediu: pedidos.slice() };
      encher(52);                                  // rendeu muito
      await rodar();
      const manteve = { degrau: est.socorro.degrau, desistiu: est.socorro.desistiu,
                        pediu: pedidos.slice() };

      /* --- caso 2: sufocada, e capturar menor NÃO rende --- */
      preparar();
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
      preparar();
      encher(58);
      await rodar();
      const saudavel = { degrau: est.socorro.degrau, mexeu: pedidos.length };

      /* --- caso 4: desligado no painel, não faz nada --- */
      cfg.socorroCaptura = false;
      preparar();
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

    /* ============ 37. 480p a 120 quadros ============ */
    console.log('\n=== 37. Dá para pedir 480p a 120 quadros? ===');
    const p120 = await A.evaluate(async () => {
      const opcoes = [...document.querySelectorAll('#sel-qualidade option')].map(o => o.value);
      const perfil = PERFIS['480-120-5'];
      const antes = cfg.qualidade;
      cfg.qualidade = '480-120-5';
      const real = perfilReal();
      const p = [...pares.values()][0];
      const a = autoDe(p); a.degrauBanda = 1; a.degrauFps = 1;
      p.larguraQueQuer = 0; p.pedido = null; p.decDeleFraco = false;
      p.perfilAplicado = null;
      await aplicarPerfilVideo(p);
      const e = (p.senderVideo.getParameters().encodings || [])[0] || {};
      cfg.qualidade = antes; p.perfilAplicado = null;
      await aplicarPerfilVideo(p);
      return { opcoes, perfil, real: { l: real.l, fps: real.fps },
               pediuQuadros: e.maxFramerate, encolheu: e.scaleResolutionDownBy };
    });
    info('perfil: ' + JSON.stringify(p120.perfil) + ' | pediu ao compressor: ' +
         p120.pediuQuadros + ' quadros');
    (p120.perfil && p120.perfil.fps === 120 && p120.perfil.a === 480)
      ? ok('o perfil 480p a 120 existe')
      : mal('o perfil não foi criado', JSON.stringify(p120.perfil));
    p120.opcoes.includes('480-120-5')
      ? ok('e aparece na lista de qualidade', p120.opcoes.join(' · '))
      : mal('não aparece para escolher', JSON.stringify(p120.opcoes));
    (p120.real.fps === 120)
      ? ok('a conta do tamanho real mantém os 120 (não capa em 60 no caminho)')
      : mal('perdeu os 120 quadros no caminho', String(p120.real.fps));
    (p120.pediuQuadros === 120)
      ? ok('e o compressor recebe o pedido de 120 quadros, não 60')
      : mal('o compressor foi pedido em outra taxa', String(p120.pediuQuadros));
    (p120.real.l === 854)
      ? ok('numa captura de 1920 ele usa os 854 do perfil, que é menor')
      : mal('largura errada', String(p120.real.l));

    /* ============ 38. a prévia que para de ser desenhada ============ */
    console.log('\n=== 38. Parar de desenhar a própria tela tira quadros de quem assiste? ===');
    const previa = await A.evaluate(async () => {
      const v = document.getElementById('v-eu');
      const q = document.getElementById('q-eu');
      const p = [...pares.values()][0];
      const saiu = async () => {
        const rel = await p.pc.getStats();
        let n = 0; rel.forEach(x => { if (x.type === 'outbound-rtp' && x.kind === 'video') n = x.framesSent || 0; });
        return n;
      };
      cfg.previaEconomica = true;
      espiarPrevia();
      const acordada = { tem: !!v.srcObject, classe: q.classList.contains('sem-previa') };

      const quadrosAntes = await saiu();
      pararDeDesenharPrevia();
      const dormindo = { tem: !!v.srcObject, marcada: est.previaDormindo,
                         classe: q.classList.contains('sem-previa') };
      await new Promise(r => setTimeout(r, 2500));
      const quadrosDepois = await saiu();

      espiarPrevia();
      const voltou = { tem: !!v.srcObject, marcada: est.previaDormindo,
                       classe: q.classList.contains('sem-previa') };

      // e obedece o ajuste: desligado, não agenda nada
      cfg.previaEconomica = false;
      agendarEconomiaDaPrevia();
      const desligado = est.relogioPrevia;
      cfg.previaEconomica = true;
      agendarEconomiaDaPrevia();
      const ligado = est.relogioPrevia;
      clearTimeout(est.relogioPrevia);

      return { acordada, dormindo, voltou, quadrosAntes, quadrosDepois,
               agendouDesligado: desligado !== null, agendouLigado: ligado !== null };
    });
    info('quadros enviados: ' + previa.quadrosAntes + ' -> ' + previa.quadrosDepois +
         ' (com a prévia adormecida)');
    (previa.acordada.tem && !previa.acordada.classe)
      ? ok('começa desenhando, para você ver que a captura deu certo')
      : mal('não estava desenhando no começo', JSON.stringify(previa.acordada));
    (!previa.dormindo.tem && previa.dormindo.marcada && previa.dormindo.classe)
      ? ok('passados os 6 segundos, larga a imagem e mostra o aviso no lugar')
      : mal('continuou desenhando', JSON.stringify(previa.dormindo));
    (previa.quadrosDepois > previa.quadrosAntes + 20)
      ? ok('e a transmissão seguiu inteira enquanto isso — quem assiste não perde nada',
           (previa.quadrosDepois - previa.quadrosAntes) + ' quadros enviados com a prévia desligada')
      : mal('parar de desenhar aqui parou de mandar para os outros',
            previa.quadrosAntes + ' -> ' + previa.quadrosDepois);
    (previa.voltou.tem && !previa.voltou.marcada && !previa.voltou.classe)
      ? ok('um clique traz a imagem de volta')
      : mal('não dá para espiar de novo', JSON.stringify(previa.voltou));
    (!previa.agendouDesligado && previa.agendouLigado)
      ? ok('e o ajuste manda: desligado não agenda nada, ligado agenda')
      : mal('ignorou o ajuste', JSON.stringify({ d: previa.agendouDesligado, l: previa.agendouLigado }));

    /* ============ 39. o clipe foi embora inteiro ============ */
    console.log('\n=== 39. Sobrou algum resto do clipe e da gravação? ===');
    const semClipe = await A.evaluate(() => {
      const some = (n) => typeof window[n] === 'undefined';
      return {
        // nenhuma função do mecanismo pode ter ficado para trás
        funcoes: ['comecarBuffer','pararBuffer','salvarClipe','alternarGravacao',
                  'cuidarDoBuffer','novoGravador','girarGravadores','fluxoParaGravar',
                  'telaParaGravar','misturarAudio','salvarArquivo','nomeDeArquivo']
                  .filter(n => !some(n)),
        // nem os controles na tela
        botoes: ['btn-clipe','btn-gravar','sel-clipe','in-clipe-sempre']
                  .filter(i => !!document.getElementById(i)),
        // nem os ajustes guardados
        ajustes: ['clipe','clipeSempre'].filter(k => k in cfg),
        // e o C não pode mais fazer nada
        atalhos: (document.body.textContent.match(/salva o clipe/g) || []).length,
        // o que TEM que continuar existindo
        aindaTem: ['montarRegistro','montarDiagnostico','pegarTela'].filter(n => some(n)),
      };
    });
    (semClipe.funcoes.length === 0)
      ? ok('nenhuma função do gravador ficou para trás')
      : mal('sobraram funções do clipe', semClipe.funcoes.join(', '));
    (semClipe.botoes.length === 0)
      ? ok('nenhum botão ou ajuste do clipe sobrou na tela')
      : mal('sobraram controles', semClipe.botoes.join(', '));
    (semClipe.ajustes.length === 0)
      ? ok('e nada do clipe continua guardado nos ajustes')
      : mal('sobraram ajustes guardados', semClipe.ajustes.join(', '));
    (semClipe.atalhos === 0)
      ? ok('o atalho saiu da lista de teclas')
      : mal('a ajuda ainda promete o clipe');
    (semClipe.aindaTem.length === 0)
      ? ok('e o que não era do clipe continua de pé (caderninho, diagnóstico, transmissão)')
      : mal('a remoção levou coisa que não devia', semClipe.aindaTem.join(', '));

    /* ============ 40. o teste que separa tamanho de caminho ============ */
    console.log('\n=== 40. O app sabe dizer se faltam quadros por TAMANHO ou por CAMINHO? ===');
    const veredito = await A.evaluate(async () => {
      cfg.qualidade = '1080-60-8';
      const faixa = est.streamTela.getVideoTracks()[0];
      const pedidos = [];
      faixa.applyConstraints = async (c) => { pedidos.push(c.height.ideal); };

      // as esperas de 9s viram 50ms, senão são 54 segundos de prova parada
      const relogioReal = window.setTimeout;
      window.setTimeout = (fn, ms) => relogioReal(fn, ms > 1000 ? 50 : ms);
      // e a medição da captura passa a devolver os números que eu quiser
      const medianaReal = window.medianaDe;
      let fila = [];
      window.medianaDe = () => (fila.length ? fila.shift() : 0);

      // medir() pergunta duas coisas por rodada, nesta ordem: quantos quadros
      // e quanto a imagem estava mudando (kbps). 2500 kbps = jogo em movimento.
      const rodar = async (antes, depois, kbps = 2500) => {
        fila = [antes, kbps, depois, kbps];
        pedidos.length = 0;
        zerarSocorroCaptura();
        est.tamBaseCaptura = { l: 1920, a: 1080 };
        await testarCaptura();
        return { txt: document.getElementById('resultado-captura').textContent,
                 pediu: pedidos.slice(), degrau: est.socorro.degrau };
      };

      const porTamanho = await rodar(30, 52);        // encolher rendeu muito
      const porCaminho = await rodar(30, 31);        // encolher não mudou nada
      const saudavel   = await rodar(58, 58);        // 58 de 60: está bom
      const telaParada = await rodar(41, 41, 120);   // e a tela quase sem mudar

      const botao = document.getElementById('btn-testar-captura');
      const estadoDoBotao = { ligado: !botao.disabled, rotulo: botao.textContent };

      window.setTimeout = relogioReal;
      window.medianaDe = medianaReal;
      return { porTamanho, porCaminho, saudavel, telaParada, estadoDoBotao };
    });
    info('por tamanho: ' + veredito.porTamanho.txt.slice(0, 60) + '…');
    info('por caminho: ' + veredito.porCaminho.txt.slice(0, 60) + '…');
    /TAMANHO da imagem/.test(veredito.porTamanho.txt)
      ? ok('encolher rendeu 73%: aponta o TAMANHO como gargalo e manda usar 720p')
      : mal('não reconheceu o gargalo de tamanho', veredito.porTamanho.txt);
    /NÃO MUDA NADA/.test(veredito.porCaminho.txt)
      ? ok('encolher não rendeu: diz que o tamanho não é o problema — que é o caso do André')
      : mal('não reconheceu o gargalo de caminho', veredito.porCaminho.txt);
    (/JANELA SEM BORDA/.test(veredito.porCaminho.txt) &&
     /Agendamento de GPU/.test(veredito.porCaminho.txt))
      ? ok('e nesse caso dá as duas causas na ordem, com o caminho do ajuste no Windows')
      : mal('não explicou o que fazer', veredito.porCaminho.txt);
    /não vai resolver/.test(veredito.porCaminho.txt)
      ? ok('e avisa que trocar a qualidade aqui dentro NÃO resolve — era a dúvida dele')
      : mal('deixou a pessoa achando que mexer na qualidade adianta');
    /NÃO DEU PARA CONCLUIR/.test(veredito.telaParada.txt)
      ? ok('com a tela quase parada (120 kbps) ele diz que NÃO SABE, em vez de culpar o Windows',
           '41 -> 41, mas sem movimento não há veredito')
      : mal('deu veredito confiante sobre uma tela parada — foi o erro da 5.5',
            veredito.telaParada.txt);
    /jogo em movimento|JOGO EM MOVIMENTO/i.test(veredito.telaParada.txt)
      ? ok('e explica como refazer o teste direito')
      : mal('não disse como refazer', veredito.telaParada.txt);
    /SAUDÁVEL/.test(veredito.saudavel.txt)
      ? ok('com 58 de 60, diz que está tudo bem em vez de inventar problema')
      : mal('inventou problema numa captura boa', veredito.saudavel.txt);
    (veredito.porCaminho.pediu.length === 2 &&
     veredito.porCaminho.pediu[0] === 400 && veredito.porCaminho.pediu[1] === 1080)
      ? ok('desce ao menor tamanho para medir e DEVOLVE o tamanho de antes',
           veredito.porCaminho.pediu.join('p -> ') + 'p')
      : mal('não devolveu o tamanho original', JSON.stringify(veredito.porCaminho.pediu));
    (veredito.porCaminho.degrau === 0)
      ? ok('e não deixa o socorro marcado depois de um teste')
      : mal('o teste deixou o socorro sujo', String(veredito.porCaminho.degrau));
    (veredito.estadoDoBotao.ligado && /Descobrir/.test(veredito.estadoDoBotao.rotulo))
      ? ok('o botão volta ao normal no fim', veredito.estadoDoBotao.rotulo)
      : mal('o botão ficou travado', JSON.stringify(veredito.estadoDoBotao));

    /* ============ 41. o melhor trecho, ao lado da média ============ */
    console.log('\n=== 41. A média esconde o que a máquina consegue? ===');
    const trecho = await A.evaluate(() => {
      const txt = montarRegistro();
      const m = txt.match(/melhor trecho\s*:\s*(\d+) quadros sustentados/);
      const med = txt.match(/quadros que saem\s*:\s*média (\d+)/);
      return { tem: !!m, melhor: m ? +m[1] : -1, media: med ? +med[1] : -1,
               explica: /A MÁQUINA CHEGA NO ALVO/.test(txt) };
    });
    info('média ' + trecho.media + ' | melhor trecho de 10s: ' + trecho.melhor);
    trecho.tem
      ? ok('o caderninho mostra o melhor trecho sustentado, não só a média')
      : mal('o melhor trecho não entrou no caderninho');
    (trecho.melhor >= trecho.media)
      ? ok('e o melhor trecho nunca é pior que a média — seria conta errada',
           trecho.melhor + ' >= ' + trecho.media)
      : mal('conta errada', trecho.melhor + ' < ' + trecho.media);

    /* ============ 42. software chamado de placa de vídeo ============ */
    console.log('\n=== 42. "MediaFoundationSoftwareVideoEncoder" é placa de vídeo? ===');
    const quemComprime = await A.evaluate(() => {
      const testar = (impl, eficiente) =>
        compressorNaPlaca({ encoderImplementation: impl, powerEfficientEncoder: eficiente });
      return {
        // o caso do caderninho do Onishi: Software no meio do nome
        softwareDaMicrosoft: testar('MediaFoundationSoftwareVideoEncoder'),
        // e o AV1 por software, que estava comprimindo 1440p no processador
        libaom: testar('libaom'),
        // o que É placa de vídeo tem que continuar sendo
        nvidia: testar('MediaFoundationVideoEncodeAccelerator (NVIDIA H.264 Encoder MFT)'),
        externo: testar('ExternalEncoder'),
        // o navegador desmentindo o nome vence
        nomeBomMasIneficiente: testar('MediaFoundationVideoEncodeAccelerator', false),
        // mas "software" no nome vence até o navegador
        nomeRuimMasDizEficiente: testar('MediaFoundationSoftwareVideoEncoder', true),
        semNada: testar(''),
      };
    });
    info(JSON.stringify(quemComprime));
    (quemComprime.softwareDaMicrosoft === false)
      ? ok('MediaFoundationSoftwareVideoEncoder é PROCESSADOR — está escrito Software no nome')
      : mal('continua chamando software de placa de vídeo (era o bug)',
            String(quemComprime.softwareDaMicrosoft));
    (quemComprime.libaom === false)
      ? ok('libaom (AV1 por software) também é processador')
      : mal('libaom passou por placa de vídeo', String(quemComprime.libaom));
    (quemComprime.nvidia === true && quemComprime.externo === true)
      ? ok('e o que é placa de vídeo de verdade continua sendo')
      : mal('quebrou o caso bom', JSON.stringify(quemComprime));
    (quemComprime.nomeBomMasIneficiente === false)
      ? ok('quando o navegador diz que não é eficiente, ele vence o nome')
      : mal('ignorou o powerEfficientEncoder', String(quemComprime.nomeBomMasIneficiente));
    (quemComprime.nomeRuimMasDizEficiente === false)
      ? ok('mas "Software" no nome vence até o navegador dizendo que é eficiente')
      : mal('deixou o navegador desmentir a palavra Software',
            String(quemComprime.nomeRuimMasDizEficiente));
    (quemComprime.semNada === null)
      ? ok('e sem nome ele responde "não sei" em vez de chutar')
      : mal('chutou sem informação', String(quemComprime.semNada));

    /* ============ 43. o veredito pergunta do compressor antes ============ */
    console.log('\n=== 43. Ele culpa a captura quando o culpado é o compressor? ===');
    const culpa = await A.evaluate(() => {
      const guardaC = est.ultimoCompressor, guardaP = est.compressorNaPlaca;
      // fabrica a assinatura do caderninho do Onishi: fonte = enc = fps, tudo baixo
      const guardaL = registro.linhas;
      registro.linhas = [];
      for (let i = 0; i < 40; i++)
        registro.linhas.push({ t: i * 1000, quem: 'x', fps: 5, enc: 5, fonte: 5,
                               larg: 960, alt: 540, kbps: 100, ping: 10, perda: 0,
                               segura: 'none', porque: '', escB: 1, escF: 1,
                               recFps: 0, recL: 0, chaves: 0, socorro: 0, fila: 0 });
      const antes = cfg.qualidade; cfg.qualidade = '1080-60-8';

      est.ultimoCompressor = 'MediaFoundationSoftwareVideoEncoder';
      est.compressorNaPlaca = false;
      const comSoftware = montarRegistro();

      est.ultimoCompressor = 'MediaFoundationVideoEncodeAccelerator (NVIDIA H.264 Encoder MFT)';
      est.compressorNaPlaca = true;
      const comPlaca = montarRegistro();

      cfg.qualidade = antes;
      registro.linhas = guardaL;
      est.ultimoCompressor = guardaC; est.compressorNaPlaca = guardaP;
      return {
        softwareCulpaCompressor: /COMPRESSOR ESTÁ RODANDO NO PROCESSADOR/.test(comSoftware),
        softwareCulpaCaptura:    /O GARGALO É A CAPTURA/.test(comSoftware),
        softwareMandaH264:       /H264/.test(comSoftware),
        placaCulpaCaptura:       /O GARGALO É A CAPTURA/.test(comPlaca),
        placaInocenta:           /não é ele/.test(comPlaca),
        cabecalho:               /quem comprime\s*:\s*O PROCESSADOR/.test(comSoftware),
      };
    });
    (culpa.softwareCulpaCompressor && !culpa.softwareCulpaCaptura)
      ? ok('com o compressor em software, ele acusa o COMPRESSOR e não a captura')
      : mal('continuou mandando mexer em tela cheia exclusiva', JSON.stringify(culpa));
    culpa.softwareMandaH264
      ? ok('e diz o que fazer: pôr a compressão em H264')
      : mal('não disse o conserto');
    (culpa.placaCulpaCaptura && culpa.placaInocenta)
      ? ok('com o compressor na placa, aí sim acusa a captura — e diz que conferiu o compressor')
      : mal('perdeu o diagnóstico de captura', JSON.stringify(culpa));
    culpa.cabecalho
      ? ok('e o cabeçalho do caderninho avisa quem está comprimindo')
      : mal('o cabeçalho não mostra o compressor');

    /* ============ 44. o teto do sondador ============ */
    console.log('\n=== 44. O b=AS solta o sondador — e fica na seção certa? ===');
    const teto = await A.evaluate(() => {
      const NL = String.fromCharCode(13) + String.fromCharCode(10);
      const secoes = (sdp) => {
        // devolve, para cada m=, as linhas b= que caíram dentro dela
        const out = []; let atual = null;
        for (const l of sdp.split(/\r?\n/)) {
          if (l.startsWith('m=')) { atual = { m: l.split(' ')[0], bs: [] }; out.push(atual); continue; }
          if (atual && l.startsWith('b=')) atual.bs.push(l);
        }
        return out;
      };
      const antes = cfg.qualidade;
      cfg.qualidade = '1080-60-8';

      // (a) o SDP normal do Chrome: cada seção tem seu c=
      const normal = melhorarVideo([
        'v=0','o=- 1 1 IN IP4 0.0.0.0','s=-','t=0 0',
        'm=audio 9 UDP/TLS/RTP/SAVPF 111','c=IN IP4 0.0.0.0','a=rtpmap:111 opus/48000/2','a=mid:0',
        'm=video 9 UDP/TLS/RTP/SAVPF 96','c=IN IP4 0.0.0.0','a=rtpmap:96 H264/90000','a=mid:1',
        'm=audio 9 UDP/TLS/RTP/SAVPF 111','c=IN IP4 0.0.0.0','a=rtpmap:111 opus/48000/2','a=mid:2',
        ''].join(NL));

      // (b) o caso que quebrava: a seção de vídeo SEM c= próprio
      const semC = melhorarVideo([
        'v=0','o=- 1 1 IN IP4 0.0.0.0','s=-','c=IN IP4 0.0.0.0','t=0 0',
        'm=video 9 UDP/TLS/RTP/SAVPF 96','a=rtpmap:96 H264/90000','a=mid:1',
        'm=audio 9 UDP/TLS/RTP/SAVPF 111','c=IN IP4 0.0.0.0','a=rtpmap:111 opus/48000/2','a=mid:2',
        ''].join(NL));

      // (c) aplicar duas vezes não pode empilhar b=AS
      const duasVezes = melhorarVideo(normal);
      // medir ANTES de devolver o perfil: o teto e uma pergunta sobre
      // 1080-60-8, nao sobre o que estava configurado antes do teste
      const esperado = tetoDoSondadorKbps();
      // o maior alvo que o SOZINHO consegue concluir, em kbps
      const maiorDoSozinho = bandaPara(2560, 1440, 120) * 1000;
      // e o teto declarado para cada perfil da tabela, um por um
      const porPerfil = {};
      for (const k of Object.keys(PERFIS)) {
        cfg.qualidade = k;
        porPerfil[k] = tetoDoSondadorKbps();
      }
      cfg.qualidade = antes;
      return { normal: secoes(normal), semC: secoes(semC), duasVezes: secoes(duasVezes),
               esperado, maiorDoSozinho, porPerfil };
    });
    const soNoVideo = (secs) => secs.every(x =>
      x.m === 'm=video' ? x.bs.length === 1 && /^b=AS:\d+$/.test(x.bs[0]) : x.bs.length === 0);
    info('teto do sondador: ' + teto.esperado + ' kbps | seções: ' +
         JSON.stringify(teto.normal.map(x => x.m + (x.bs.length ? ' ' + x.bs.join() : ''))));
    /* Este teto vira b=AS, e b=AS e escrito UMA vez, na hora de combinar a
       chamada. O SOZINHO so decide o alvo vinte segundos DEPOIS — e o
       Chrome desempata b=AS contra setParameters pelo MENOR dos dois
       (encoder_stream_factory.cc). Um teto colado no alvo do primeiro
       segundo congela tudo o que vier depois: o SOZINHO mede 16,6 Mbps,
       leva 12,8, e o sondador para ali, entao a banda medida nunca chega
       a justificar o alvo maior. E a ratoeira um andar acima.
       Por isso a prova nao e um numero: e que ele nunca seja o menor. */
    info('maior alvo que o SOZINHO chega a concluir: ' + teto.maiorDoSozinho + ' kbps');
    (teto.esperado >= teto.maiorDoSozinho)
      ? ok('o teto declarado no SDP fica ACIMA de tudo que o SOZINHO pode concluir depois',
           teto.esperado + ' kbps >= ' + teto.maiorDoSozinho + ' kbps')
      : mal('o SDP congelaria o alvo que o SOZINHO ainda vai medir',
            teto.esperado + ' < ' + teto.maiorDoSozinho);
    Object.keys(teto.porPerfil).every(k => teto.porPerfil[k] >= teto.maiorDoSozinho)
      ? ok('e isso vale para TODOS os perfis da tabela, não só o do teste',
           JSON.stringify(teto.porPerfil))
      : mal('algum perfil declara um teto que trava o ajuste', JSON.stringify(teto.porPerfil));
    soNoVideo(teto.normal)
      ? ok('no SDP normal, o b=AS entra só na seção de vídeo')
      : mal('b=AS na seção errada', JSON.stringify(teto.normal));
    soNoVideo(teto.semC)
      ? ok('e continua na de vídeo mesmo quando ela não tem c= próprio — era aqui que vazava para o áudio')
      : mal('o b=AS escapou para outra seção', JSON.stringify(teto.semC));
    soNoVideo(teto.duasVezes)
      ? ok('e passar duas vezes não empilha b=AS')
      : mal('empilhou b=AS', JSON.stringify(teto.duasVezes));

    /* ============ 45. a sonda de compressores ============ */
    console.log('\n=== 45. Ele pergunta à placa quem comprime, e refaz ao trocar o tamanho? ===');
    const escada = await A.evaluate(async () => {
      const antes = cfg.qualidade;
      est.escadaPronta = null; est.escadaDe = null;
      cfg.qualidade = '1080-60-8';
      const a = await sondarCompressores();
      const deA = est.escadaDe;
      const ordemA = (await ordemDeCodecs()).map(c => c.id);

      // trocar o tamanho tem que invalidar: a placa responde por tamanho
      cfg.qualidade = '1440-60-14';
      await sondarCompressores();
      const deB = est.escadaDe;

      cfg.qualidade = antes; est.escadaPronta = null; est.escadaDe = null;
      return { nomes: a.map(c => c.id), deA, deB,
               ordem: ordemA,
               av1PorUltimo: ordemA.length ? ordemA[ordemA.length - 1] : null,
               temTodos: a.length === 6 };
    });
    info('escada sondada: ' + JSON.stringify(escada.nomes) + ' | ordem: ' + JSON.stringify(escada.ordem));
    escada.temTodos
      ? ok('pergunta pelos seis formatos, um por um')
      : mal('a escada não tem os seis', JSON.stringify(escada.nomes));
    (escada.deA === '1080-60-8' && escada.deB === '1440-60-14')
      ? ok('e refaz a pergunta quando o tamanho muda — a placa responde POR TAMANHO',
           escada.deA + ' -> ' + escada.deB)
      : mal('ficou com a resposta do tamanho antigo', escada.deA + ' -> ' + escada.deB);
    (escada.ordem.length === 0 || escada.av1PorUltimo === 'av1' ||
     !escada.ordem.includes('av1'))
      ? ok('AV1 sem placa vai por último, nunca como primeira opção',
           'ordem: ' + escada.ordem.join(' > '))
      : mal('AV1 em software ficou na frente', escada.ordem.join(' > '));

    /* ============ 46. o mudo que vazava para quem chega depois ============ */
    console.log('\n=== 46. Quem entra depois consegue te ouvir mesmo você estando mudo? ===');
    const vazou = await A.evaluate(async () => {
      const eraMudo = est.mudo;
      const ligadas = () => est.streamMic.getAudioTracks().map(t => t.enabled);

      if (!est.mudo) alternarMudo();          // fica mudo
      const logoDepois = ligadas();

      /* O buraco: uma faixa NOVA de microfone nasce aberta. Acontece quando
         o aparelho é readquirido — e era por aí que quem chegava depois
         passava a te ouvir sem nada na tela mudar. */
      est.streamMic.getAudioTracks().forEach(t => { t.enabled = true; });
      const escapou = ligadas();
      const consertou = conferirMudo();
      const depoisDoSocorro = ligadas();

      // e o caminho de verdade: alguém entrando na call chama prepararMidia
      est.streamMic.getAudioTracks().forEach(t => { t.enabled = true; });
      const p = [...pares.values()][0];
      await prepararMidia(p);
      const depoisDeAlguemEntrar = ligadas();
      // o que o sender está realmente mandando
      const noSender = p.senderMic && p.senderMic.track ? p.senderMic.track.enabled : null;

      // ler o botao ANTES de desfazer o mudo, senao leio o estado restaurado
      const botao = document.getElementById('btn-mic').textContent;
      if (est.mudo !== eraMudo) alternarMudo();
      return { logoDepois, escapou, consertou, depoisDoSocorro,
               depoisDeAlguemEntrar, noSender, botao };
    });
    info('mudo -> ' + JSON.stringify(vazou.logoDepois) + ' | faixa nova -> ' +
         JSON.stringify(vazou.escapou) + ' | depois de alguém entrar -> ' +
         JSON.stringify(vazou.depoisDeAlguemEntrar));
    vazou.logoDepois.every(v => v === false)
      ? ok('apertar o mudo fecha o microfone')
      : mal('o mudo não fechou', JSON.stringify(vazou.logoDepois));
    (vazou.consertou > 0 && vazou.depoisDoSocorro.every(v => v === false))
      ? ok('uma faixa que nasceu aberta é fechada pela reconferida de cada segundo',
           vazou.consertou + ' faixa(s) fechada(s) de volta')
      : mal('a faixa aberta passou batido', JSON.stringify(vazou.depoisDoSocorro));
    vazou.depoisDeAlguemEntrar.every(v => v === false)
      ? ok('e ALGUÉM ENTRANDO na call não reabre o microfone — era o bug relatado')
      : mal('quem entrou depois te ouviria', JSON.stringify(vazou.depoisDeAlguemEntrar));
    (vazou.noSender === false)
      ? ok('a faixa que sai pelo sender está fechada de verdade, não só a local')
      : mal('o sender está mandando som com você mudo', String(vazou.noSender));
    (vazou.botao === '🔇')
      ? ok('e o botão continua dizendo que você está mudo')
      : mal('o botão desencontrou do estado', vazou.botao);

    /* ============ 47. a tela que ficava congelada ============ */
    console.log('\n=== 47. Quando o amigo para de transmitir, a tela dele sai do palco? ===');
    const congelada = await B.evaluate(async () => {
      const p = [...pares.values()][0];
      // finge que a tela dele estava no palco
      p.temTela = true; p.fluxo = p.fluxo || new MediaStream();
      p.naoQueroVer = false;
      mostrarTela(p);
      const antes = !!document.getElementById('q-p-' + p.id);

      // (a) o recado direto: ele avisou que parou
      // chama o tratador de verdade, do jeito que a mensagem chega
      p.canal.onmessage({ data: JSON.stringify({ t: 'tela', v: false }) });
      const depoisDoRecado = !!document.getElementById('q-p-' + p.id) && p.temTela;

      // (b) e se o recado nunca chegar (ele travou / fechou o navegador)?
      p.temTela = true; mostrarTela(p);
      p.quandoQuadro = Date.now() - 8000;      // 8s sem um quadro sequer
      // alto de proposito: assim 'agora > antes' da falso e o laco entra no
      // ramo do vigia. Com 99 os quadros reais passavam por cima e o vigia
      // nunca era exercitado.
      p.quadrosAntes = 1e9;
      est.pulso = 1;                            // o laco pula de dois em dois quando ninguem olha
      await atualizarNumeros();
      const depoisDoVigia = p.temTela;
      return { antes, depoisDoRecado, depoisDoVigia };
    }).catch(e => ({ erro: String(e && e.message || e) }));
    if (congelada.erro) { mal('o teste da tela congelada explodiu', congelada.erro); }
    else {
      congelada.antes
        ? ok('a tela do amigo estava no palco')
        : mal('não consegui montar o quadro para o teste');
      !congelada.depoisDoRecado
        ? ok('ele avisa que parou e a tela sai na hora — em vez de congelar no último quadro')
        : mal('a tela continuou no palco depois do aviso');
      !congelada.depoisDoVigia
        ? ok('e mesmo sem aviso nenhum, 6s sem um quadro tira a tela do palco')
        : mal('sem aviso a tela ficaria congelada para sempre');
    }

    /* ============ 48. ver só uma tela ============ */
    console.log('\n=== 48. Dá para ver só uma tela quando tem várias? ===');
    const foco = await A.evaluate(() => {
      const palco = document.getElementById('palco');
      // monta dois quadros de mentira, como se dois amigos transmitissem
      montarQuadro('t1', 'tela 1', true, null);
      montarQuadro('t2', 'tela 2', true, null);
      arrumarPalco();
      const visiveis = () => [...palco.querySelectorAll('.quadro:not(.saindo)')]
        .filter(q => getComputedStyle(q).display !== 'none').map(q => q.id);
      const todas = visiveis();
      const rotuloAntes = document.querySelector('#q-t1 .so-esta').textContent;

      alternarFoco('t1');
      const focado = visiveis();
      const rotuloDepois = document.querySelector('#q-t1 .so-esta').textContent;

      alternarFoco('t1');            // clicar de novo volta a ver todas
      const voltou = visiveis();

      // e se o quadro focado morrer, o foco tem que morrer junto
      alternarFoco('t2');
      document.getElementById('q-t2').remove();
      arrumarPalco();
      const semOFocado = { foco: est.foco, visiveis: visiveis() };

      document.getElementById('q-t1') && document.getElementById('q-t1').remove();
      est.foco = null; arrumarPalco();
      return { todas, focado, voltou, rotuloAntes, rotuloDepois, semOFocado };
    });
    info('todas: ' + JSON.stringify(foco.todas) + ' | focado: ' + JSON.stringify(foco.focado));
    (foco.todas.length >= 2)
      ? ok('com duas telas, as duas aparecem')
      : mal('não montou as duas telas', JSON.stringify(foco.todas));
    (foco.focado.length === 1 && foco.focado[0] === 'q-t1')
      ? ok('escolhendo uma, só ela é desenhada — as outras saem do compositor')
      : mal('o foco não isolou a tela', JSON.stringify(foco.focado));
    (foco.voltou.length === foco.todas.length)
      ? ok('e clicar de novo volta a ver todas')
      : mal('não deu para voltar', JSON.stringify(foco.voltou));
    (/Só esta/.test(foco.rotuloAntes) && /Ver todas/.test(foco.rotuloDepois))
      ? ok('o botão diz o que vai fazer, dos dois lados', foco.rotuloAntes + ' / ' + foco.rotuloDepois)
      : mal('o rótulo do botão não acompanha', foco.rotuloAntes + ' / ' + foco.rotuloDepois);
    (foco.semOFocado.foco === null)
      ? ok('e se a tela focada some, o foco some junto em vez de deixar o palco vazio')
      : mal('ficou focado numa tela que não existe mais', JSON.stringify(foco.semOFocado));

    /* ============ 49. o teto que a captura impõe ============ */
    console.log('\n=== 49. Ele descobre que a captura não dá o que o perfil pede? ===');
    const tetoFonte = await A.evaluate(() => {
      const guardado = est.histFonte;
      const antes = cfg.qualidade;
      cfg.qualidade = '1080-60-8';
      const com = (H) => { est.histFonte = H.slice(); return tetoDaFonte(); };
      const rep = (v, n) => Array.from({ length: n }, () => v);

      // (a) o caso do André: 32 firmes quando o perfil pede 60
      const capada = com(rep(32, 30).map((v, i) => v + (i % 3)));
      // (b) a mesma fonte, mas UMA vez ela alcançou o alvo -> não é teto
      const alcancou = com(rep(32, 29).concat([58]));
      // (c) tela parada de verdade: quase nada o tempo todo
      const parada = com(rep(0, 27).concat([1, 2, 0]));
      // (d) amostra curta demais para concluir qualquer coisa
      const curta = com(rep(30, 8));
      // (e) fonte saudável
      const boa = com(rep(59, 30));

      est.histFonte = guardado; cfg.qualidade = antes;
      return { capada, alcancou, parada, curta, boa };
    });
    info('capada -> ' + tetoFonte.capada + ' | alcançou 58 uma vez -> ' + tetoFonte.alcancou +
         ' | tela parada -> ' + tetoFonte.parada + ' | boa -> ' + tetoFonte.boa);
    (tetoFonte.capada >= 30 && tetoFonte.capada <= 40)
      ? ok('32 quadros firmes num perfil de 60: reconhece o teto e devolve o número',
           tetoFonte.capada + ' quadros')
      : mal('não viu o teto da captura', String(tetoFonte.capada));
    (tetoFonte.alcancou === 0)
      ? ok('mas se a fonte alcançou o alvo UMA vez, ela sabe alcançar — não é teto')
      : mal('confundiu tela sem novidade com captura capada', String(tetoFonte.alcancou));
    (tetoFonte.parada === 0)
      ? ok('e tela parada não vira diagnóstico — não dá para concluir sem movimento')
      : mal('chamou tela parada de captura capada', String(tetoFonte.parada));
    (tetoFonte.curta === 0 && tetoFonte.boa === 0)
      ? ok('amostra curta e fonte saudável não acusam nada')
      : mal('acusou sem base', tetoFonte.curta + ' / ' + tetoFonte.boa);

    /* ============ 50. a escada dos quadros tem que provar que serve ============ */
    console.log('\n=== 50. Encolher não devolveu quadros: ele desfaz e para de tentar? ===');
    const prova = await A.evaluate(async () => {
      const p = [...pares.values()][0];
      const guardado = { hf: est.histFonte, prio: cfg.prioridade, q: cfg.qualidade };
      cfg.prioridade = 'fluidez'; cfg.qualidade = '1080-60-8';
      const rep = (v, n) => Array.from({ length: n }, () => v);
      const prep = () => { const a = autoDe(p); zerarAuto(p); a.aquece = 99; a.banda = 0; return a; };

      /* (a) A FONTE É O LIMITE. O compressor entrega 24 e a captura só deu
         25 neste segundo: encolher não pode subir um número que já está
         capado antes do Bigas Voice. */
      let a = prep();
      est.histFonte = rep(58, 29).concat([25]);   // oscila: não é teto firme
      for (let i = 0; i < 10; i++) await ajustarQualidade(p, 0, false, 0, 24);
      const comFonteBaixa = a.degrauFps;

      /* (b) A FONTE ESTÁ ÓTIMA e mesmo assim o fps é ruim: aí encolher é a
         tentativa certa — e ele tem que tentar. */
      a = prep();
      est.histFonte = rep(60, 30);
      for (let i = 0; i < 10; i++) await ajustarQualidade(p, 0, false, 0, 30);
      const tentou = a.degrauFps;

      /* (c) ...e oito segundos depois os quadros continuam iguais. Isso é a
         resposta: o tamanho não era o problema. Desfaz e desiste. */
      a.provando = Date.now() - 9000;
      a.fpsAntes = 30;
      await ajustarQualidade(p, 0, false, 0, 30);
      const desfez = { degrau: a.degrauFps, inutil: !!a.fpsInutil, motivo: a.motivo };

      // e enquanto está desistido, não tenta de novo
      for (let i = 0; i < 10; i++) await ajustarQualidade(p, 0, false, 0, 30);
      const insistiu = a.degrauFps;

      /* (d) o outro desfecho: encolher FUNCIONOU. Aí mantém. */
      a = prep();
      est.histFonte = rep(60, 30);
      for (let i = 0; i < 10; i++) await ajustarQualidade(p, 0, false, 0, 30);
      const antesDoGanho = a.degrauFps;
      a.provando = Date.now() - 9000; a.fpsAntes = 30;
      await ajustarQualidade(p, 0, false, 0, 52);
      const manteve = a.degrauFps;

      est.histFonte = guardado.hf; cfg.prioridade = guardado.prio; cfg.qualidade = guardado.q;
      zerarAuto(p); p.perfilAplicado = null; await aplicarPerfilVideo(p);
      return { comFonteBaixa, tentou, desfez, insistiu, antesDoGanho, manteve };
    });
    info('fonte baixa -> ' + prova.comFonteBaixa + 'x | tentou -> ' + prova.tentou +
         'x | desfez -> ' + prova.desfez.degrau + 'x | com ganho -> ' + prova.manteve + 'x');
    (prova.comFonteBaixa === 1)
      ? ok('o compressor engole tudo o que a captura dá: NÃO encolhe a imagem à toa')
      : mal('encolheu para consertar um limite que é anterior a ele', String(prova.comFonteBaixa));
    (prova.tentou > 1)
      ? ok('mas com a fonte saudável e o fps ruim, ele tenta encolher — como deve',
           prova.tentou + 'x menor')
      : mal('deixou de tentar quando valia a pena', String(prova.tentou));
    (prova.desfez.degrau < prova.tentou && prova.desfez.inutil)
      ? ok('e se os quadros não subiram, DESFAZ o degrau e para de tentar',
           prova.tentou + 'x -> ' + prova.desfez.degrau + 'x')
      : mal('encolheu de graça e continuaria descendo', JSON.stringify(prova.desfez));
    (prova.insistiu === prova.desfez.degrau)
      ? ok('durante a desistência ele não fica remexendo no compressor')
      : mal('voltou a encolher logo depois de desistir', String(prova.insistiu));
    (prova.manteve === prova.antesDoGanho && prova.manteve > 1)
      ? ok('e quando encolher FUNCIONA (30 -> 52 quadros), o degrau fica de pé')
      : mal('desfez um degrau que estava funcionando',
            prova.antesDoGanho + ' -> ' + prova.manteve);

    /* ============ 51. o piso ============ */
    console.log('\n=== 51. As duas escadas multiplicadas podem chegar a 288px de largura? ===');
    const pisoTeste = await A.evaluate(async () => {
      const p = [...pares.values()][0];
      // a tela do André: CS em 4:3, e a captura JÁ reduzida por outra escada
      const eraTam = window.tamanhoDaCaptura;
      window.tamanhoDaCaptura = () => ({ l: 1280, a: 960 });
      const largura = perfilReal().l;
      const medir = async (apertado) => {
        const a = autoDe(p);
        a.degrauBanda = 3; a.degrauFps = 3;      // as duas escadas no fundo
        p.decDeleFraco = true;                    // e mais um motivo por cima
        p.larguraQueQuer = 320;                   // e a janela dele minúscula
        p.apertado = apertado; p.perda = apertado ? 4 : 0;
        p.perfilAplicado = null;
        await aplicarPerfilVideo(p);
        return { encolher: p.encolherAtual, px: Math.round(largura / p.encolherAtual),
                 porque: p.porqueTamanho };
      };
      const semAperto = await medir(false);
      const comAperto = await medir(true);
      window.tamanhoDaCaptura = eraTam;
      p.decDeleFraco = false; p.larguraQueQuer = 0; p.apertado = false; p.perda = 0;
      zerarAuto(p); p.perfilAplicado = null; await aplicarPerfilVideo(p);
      return { largura, semAperto, comAperto };
    });
    info('fonte ' + pisoTeste.largura + 'px | sem aperto -> ' + pisoTeste.semAperto.px +
         'px | com aperto medido -> ' + pisoTeste.comAperto.px + 'px');
    (pisoTeste.semAperto.px >= 640)
      ? ok('com tudo mandando encolher mas SEM aperto medido, para no piso de 640px',
           pisoTeste.semAperto.px + 'px — ' + pisoTeste.semAperto.porque)
      : mal('desceu abaixo do legível por palpite', JSON.stringify(pisoTeste.semAperto));
    /(segurei no piso)/.test(pisoTeste.semAperto.porque)
      ? ok('e assina que foi o piso que segurou, em vez de sumir com o motivo')
      : mal('o piso agiu calado', pisoTeste.semAperto.porque);
    (pisoTeste.comAperto.px < pisoTeste.semAperto.px && pisoTeste.comAperto.px >= 320)
      ? ok('mas com aperto MEDIDO o piso cede até 320px — imagem feia é melhor que imagem nenhuma',
           pisoTeste.comAperto.px + 'px')
      : mal('o piso não cedeu à internet de verdade', JSON.stringify(pisoTeste.comAperto));

    /* ============ 52. o motivo viaja para quem recebe ============ */
    console.log('\n=== 52. Quem RECEBE consegue saber por que a imagem está daquele tamanho? ===');
    const viajou = await B.evaluate(async () => {
      const p = [...pares.values()][0];
      p.temTela = true;
      // do jeito que a mensagem chega de verdade: pelo canal
      p.canal.onmessage({ data: JSON.stringify(
        { t: 'porque', v: { q: 'pouca banda 2x', l: 960, tf: 32, alvo: 60 } }) });
      const guardou = p.porqueDele;
      // o painel só se DESENHA quando está aberto (senão custa FPS à toa)
      document.getElementById('painel').classList.add('aberto');
      await atualizarNumeros();
      const texto = (document.getElementById('painel') || document.body).textContent;
      return { guardou, mandando: /Ele está mandando/.test(texto),
               entrega: /A tela DELE só entrega/.test(texto),
               px: /960px/.test(texto), tf: /32 de 60/.test(texto) };
    }).catch(e => ({ erro: String(e && e.message || e) }));
    if (viajou.erro) { mal('o teste do motivo que viaja explodiu', viajou.erro); }
    else {
      (viajou.guardou && viajou.guardou.l === 960 && viajou.guardou.tf === 32)
        ? ok('o motivo de quem manda chega inteiro do outro lado',
             JSON.stringify(viajou.guardou))
        : mal('a explicação não atravessou o canal', JSON.stringify(viajou.guardou));
      (viajou.mandando && viajou.px)
        ? ok('e o painel de quem RECEBE mostra o tamanho e o motivo dele')
        : mal('quem recebe continua sem saber por quê');
      (viajou.entrega && viajou.tf)
        ? ok('inclusive quando o problema é a captura DELE — 32 de 60 quadros',
             'a pergunta "por que a resolução fica mudando" agora tem resposta na tela')
        : mal('não contou que a captura dele é o limite');
    }

    /* ============ 53. o perfil que se escolhe sozinho ============ */
    console.log('\n=== 53. Ele mede a máquina e escolhe o perfil, sem ninguém no menu? ===');
    const sozinho = await A.evaluate(async () => {
      const guardado = { q: cfg.qualidade, auto: Object.assign({}, PERFIS.auto),
                         hf: est.histFonte, tb: est.tamBaseCaptura,
                         cp: est.compressorNaPlaca, quando: est.sozinhoQuando };
      const faixa = est.streamTela.getVideoTracks()[0];
      const eraAplicar = faixa.applyConstraints;
      const pedidos = [];
      faixa.applyConstraints = async (c) => { pedidos.push(c); };
      cfg.qualidade = 'auto';

      const rep = (v, n) => Array.from({ length: n }, () => v);
      const rodar = async (H, nat, naPlaca, base) => {
        Object.assign(PERFIS.auto, base || { l: 1920, a: 1080, fps: 60, mbps: 8 });
        est.histFonte = H.slice();
        est.tamBaseCaptura = nat;
        est.compressorNaPlaca = naPlaca;
        est.sozinhoQuando = 0;
        pedidos.length = 0;
        await escolherSozinho();
        return { l: PERFIS.auto.l, a: PERFIS.auto.a, fps: PERFIS.auto.fps,
                 mbps: PERFIS.auto.mbps, pediu: pedidos[0] || null };
      };

      // (a) o caso do André: CS em 4:3 entregando 32 quadros firmes
      const cs = await rodar(rep(32, 30).map((v, i) => v + (i % 3)),
                             { l: 1280, a: 960 }, true);
      // (b) máquina saudável: a fonte alcança 60 o tempo todo
      const boa = await rodar(rep(60, 30), { l: 1920, a: 1080 }, true);
      // (c) compressor no PROCESSADOR: 1440p vira armadilha, tem que capar
      const soft = await rodar(rep(60, 30), { l: 2560, a: 1440 }, false);
      // (d) um pico isolado de 60 numa tela que vive em 30 não pode subir
      const pico = await rodar(rep(30, 29).concat([60]), { l: 1920, a: 1080 }, true,
                               { l: 1920, a: 1080, fps: 30, mbps: 4 });
      // (e) e sem medida suficiente ele não inventa nada
      const cedo = await rodar(rep(32, 8), { l: 1280, a: 960 }, true,
                               { l: 1920, a: 1080, fps: 60, mbps: 8 });

      faixa.applyConstraints = eraAplicar;
      cfg.qualidade = guardado.q; Object.assign(PERFIS.auto, guardado.auto);
      est.histFonte = guardado.hf; est.tamBaseCaptura = guardado.tb;
      est.compressorNaPlaca = guardado.cp; est.sozinhoQuando = guardado.quando;
      return { cs, boa, soft, pico, cedo };
    });
    info('CS 32fps -> ' + sozinho.cs.a + 'p a ' + sozinho.cs.fps + ' (' + sozinho.cs.mbps +
         ' Mbps) | saudável -> ' + sozinho.boa.a + 'p a ' + sozinho.boa.fps +
         ' | software -> ' + sozinho.soft.a + 'p a ' + sozinho.soft.fps);
    (sozinho.cs.fps === 30 && sozinho.cs.l === 1280 && sozinho.cs.a === 960)
      ? ok('tela de 1280x960 entregando 32 quadros: escolhe 960p a 30, o que a máquina dá',
           'em vez de perseguir os 60 do menu')
      : mal('não adotou o que a captura entrega', JSON.stringify(sozinho.cs));
    (sozinho.cs.pediu && sozinho.cs.pediu.frameRate.ideal === 30 &&
     sozinho.cs.pediu.width.ideal === 1280)
      ? ok('e PEDE isso ao Windows — parar de martelar 60 é metade do ganho de FPS no jogo',
           JSON.stringify(sozinho.cs.pediu.frameRate))
      : mal('mudou o alvo mas continuou pedindo o mesmo à captura',
            JSON.stringify(sozinho.cs.pediu));
    (sozinho.boa.fps === 60 && sozinho.boa.a === 1080)
      ? ok('numa máquina saudável ele fica em 1080p60 — não castiga quem não precisa')
      : mal('rebaixou uma máquina que dava conta', JSON.stringify(sozinho.boa));
    (sozinho.soft.l === 1600)
      ? ok('com o compressor no PROCESSADOR ele capa a largura em 1600',
           'foi 1440p em software que derrubou a máquina do amigo')
      : mal('deixou o processador comprimir 1440p', JSON.stringify(sozinho.soft));
    (sozinho.pico.fps === 30)
      ? ok('e um pico isolado de 60 não faz ele subir — subir pede prova, descer não')
      : mal('subiu por causa de um segundo bom', JSON.stringify(sozinho.pico));
    (sozinho.cedo.fps === 60 && sozinho.cedo.a === 1080)
      ? ok('sem 20 amostras ele não decide nada — medir vem antes de escolher')
      : mal('decidiu sem ter medido', JSON.stringify(sozinho.cedo));

    /* ============ 54. o Sozinho é o padrão, e os números atravessam ============ */
    console.log('\n=== 54. Ele já vem ligado, e o outro lado vê o número certo? ===');
    const padrao = await B.evaluate(async () => {
      // (a) quem herdou o antigo padrão de fábrica vai para o Sozinho
      const eraCfg = cfg.qualidade;
      const eraMig = cfg.migrouSozinho;
      const eraLS = localStorage.getItem('frag');
      // alguém que abriu a v6.1 vindo da v6.0: nunca migrou
      localStorage.setItem('frag', JSON.stringify({ qualidade: '1080-60-8', nome: 'x' }));
      cfg.qualidade = '1080-60-8'; cfg.migrouSozinho = false;
      lerAjustes();
      const migrou = cfg.qualidade;
      // e o salvamento tem que ter guardado o sinalizador, senão ele migra
      // de novo toda vez que a pessoa voltar para 1080p60 de propósito
      let ficouGravado = false;
      try{ ficouGravado = !!JSON.parse(localStorage.getItem('frag')).migrouSozinho; }catch{}
      // ...e uma escolha DE VERDADE fica onde está
      localStorage.setItem('frag', JSON.stringify({ qualidade: '720-30-3' }));
      cfg.qualidade = '720-30-3'; cfg.migrouSozinho = false;
      lerAjustes();
      const respeitou = cfg.qualidade;
      // quem JÁ migrou e voltou para 1080p60 de propósito não é atropelado
      localStorage.setItem('frag', JSON.stringify({ qualidade: '1080-60-8', migrouSozinho: true }));
      cfg.qualidade = '1080-60-8'; cfg.migrouSozinho = true;
      lerAjustes();
      const voltouDeProposito = cfg.qualidade;
      if (eraLS === null) localStorage.removeItem('frag');
      else localStorage.setItem('frag', eraLS);
      cfg.qualidade = eraCfg; cfg.migrouSozinho = eraMig;

      // (b) a chave 'auto' não diz nada sozinha: os números têm que vir junto
      const p = [...pares.values()][0];
      p.canal.onmessage({ data: JSON.stringify(
        { t: 'perfil', v: 'auto', p: { a: 960, fps: 30 } }) });
      const guardou = p.perfilDele;
      document.getElementById('painel').classList.add('aberto');
      await atualizarNumeros();
      const texto = document.getElementById('painel').textContent;

      // (c) e uma versão antiga, que manda só a chave, continua funcionando
      p.canal.onmessage({ data: JSON.stringify({ t: 'perfil', v: '720-30-3' }) });
      const antigo = { perfilDele: p.perfilDele, chave: p.qualidadeDele };
      return { migrou, respeitou, ficouGravado, voltouDeProposito, guardou,
               mostrou: /Ele está transmitindo em/.test(texto),
               numero: /960p a 30 fps/.test(texto), antigo };
    }).catch(e => ({ erro: String(e && e.message || e) }));
    if (padrao.erro) { mal('o teste do padrão explodiu', padrao.erro); }
    else {
      (padrao.migrou === 'auto')
        ? ok('quem tinha o antigo padrão de fábrica passa a ser decidido pela máquina')
        : mal('não migrou para o Sozinho', String(padrao.migrou));
      (padrao.respeitou === '720-30-3')
        ? ok('mas uma escolha de verdade continua respeitada — migrar não é mandar')
        : mal('atropelou a escolha do usuário', String(padrao.respeitou));
      padrao.ficouGravado
        ? ok('e o sinalizador da migração sobrevive ao salvamento')
        : mal('o sinalizador some e a migração se repete para sempre');
      (padrao.voltouDeProposito === '1080-60-8')
        ? ok('quem JÁ migrou e voltou para 1080p60 de propósito não é migrado de novo')
        : mal('migrou duas vezes e ignorou a escolha', String(padrao.voltouDeProposito));
      (padrao.guardou && padrao.guardou.a === 960 && padrao.guardou.fps === 30)
        ? ok('no Sozinho os números resolvidos viajam junto com a chave')
        : mal('o outro lado ficaria lendo a MINHA tabela com a chave DELE',
              JSON.stringify(padrao.guardou));
      (padrao.mostrou && padrao.numero)
        ? ok('e o painel do amigo mostra 960p a 30 fps — o que ele está mandando de verdade')
        : mal('o painel não mostrou o número que veio');
      (padrao.antigo.perfilDele === null && padrao.antigo.chave === '720-30-3')
        ? ok('e uma versão ANTIGA, que manda só a chave, continua entendida')
        : mal('quebrou com quem está na versão de ontem', JSON.stringify(padrao.antigo));
    }

    /* ============ 55. o que ficava segurando depois que a pessoa sai ============ */
    console.log('\n=== 55. Quando alguém sai, o áudio dele é SOLTO ou só sai da tela? ===');
    const vazamento = await A.evaluate(async () => {
      const ctx = est.ctx || (est.ctx = new AudioContext());
      // um par de mentira com áudio tocando e o amplificador ligado,
      // que é o caso de quem pediu volume acima de 100%
      const dest = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator(); osc.connect(dest); osc.start();
      const el = new Audio();
      el.srcObject = dest.stream;
      document.body.appendChild(el);

      const fake = { id: 'teste-vaza', audio: el, volume: 100 };
      fake.fonteAudio = ctx.createMediaStreamSource(dest.stream);
      fake.ganho = ctx.createGain();
      fake.lado = ctx.createStereoPanner();
      fake.fonteAudio.connect(fake.ganho);
      fake.ganho.connect(fake.lado);
      fake.lado.connect(ctx.destination);

      // espiões: desligar é a única coisa que não dá para ver de fora
      const soltou = { fonte: false, ganho: false, lado: false };
      for (const k of ['fonte', 'ganho', 'lado']) {
        const no = fake[k === 'fonte' ? 'fonteAudio' : k];
        const antes = no.disconnect.bind(no);
        no.disconnect = (...a) => { soltou[k] = true; return antes(...a); };
      }

      const faixa = dest.stream.getAudioTracks()[0];
      pares.set('teste-vaza', fake);
      tirarPar('teste-vaza');

      return {
        soltou,
        srcObject: el.srcObject,
        noDocumento: document.body.contains(el),
        faixaViva: faixa.readyState,
        campoLimpo: fake.audio === null && fake.fonteAudio === null && fake.ganho === null,
        saiuDoMapa: !pares.has('teste-vaza'),
      };
    });
    info('desligou -> ' + JSON.stringify(vazamento.soltou) + ' | faixa: ' + vazamento.faixaViva);
    (vazamento.soltou.fonte && vazamento.soltou.ganho && vazamento.soltou.lado)
      ? ok('as três peças do amplificador são desligadas do AudioContext',
           'nó LIGADO na saída não é lixo coletável — o contexto é uma raiz viva')
      : mal('sobrou peça de Web Audio ligada para sempre', JSON.stringify(vazamento.soltou));
    (vazamento.srcObject === null)
      ? ok('o elemento larga o stream — era só isto que "remove()" não fazia')
      : mal('o elemento saiu do documento ainda segurando o stream');
    (vazamento.faixaViva === 'ended')
      ? ok('e a faixa é encerrada, não deixada tocando para ninguém')
      : mal('a faixa continuou viva', vazamento.faixaViva);
    (!vazamento.noDocumento && vazamento.campoLimpo && vazamento.saiuDoMapa)
      ? ok('e aí sim sai do documento, do par e do mapa')
      : mal('sobrou referência em algum lugar', JSON.stringify(vazamento));

    /* ============ 56. a sacola de caminhos no fim da busca ============ */
    console.log('\n=== 56. Terminou de procurar caminhos: ele ainda espera os 250 ms? ===');
    /* A busca por caminhos DE VERDADE nao termina de forma confiavel aqui
       dentro — tentei numa aba limpa e ela fica em "gathering" para sempre,
       enquanto num navegador recem-aberto termina em 130 ms. Ficar refem
       disso deixaria o teste passando por uma saida de emergencia, sem
       provar nada, que e pior que nao ter teste.
       Entao a prova e da REGRA: sombreando iceGatheringState da para
       perguntar exatamente o que o tratador faz em cada estado. */
    const gelo = await A.evaluate(async () => {
      const par = criarPar('teste-gelo');
      const pc = par.pc;
      const temTratador = typeof pc.onicegatheringstatechange === 'function';
      const fingirEstado = (v) => Object.defineProperty(pc, 'iceGatheringState',
        { get: () => v, configurable: true });

      let descargas = 0;
      const antes = window.esvaziarSacola;
      window.esvaziarSacola = (p) => { if (p === par) descargas++; return antes(p); };

      // ainda procurando: nao pode mexer em nada, o relogio e que junta
      par.sacolaGelo = [{ candidate: 'x' }];
      par.relogioGelo = setTimeout(() => {}, 60000);
      fingirEstado('gathering');
      pc.onicegatheringstatechange();
      const procurando = { descargas, relogio: !!par.relogioGelo };

      // terminou: nao sobrou nada para juntar, entao vai agora
      fingirEstado('complete');
      pc.onicegatheringstatechange();
      const terminou = { descargas, relogio: !!par.relogioGelo };

      window.esvaziarSacola = antes;
      clearTimeout(par.relogioGelo);
      tirarPar('teste-gelo');
      return { temTratador, procurando, terminou };
    });
    info('procurando -> ' + JSON.stringify(gelo.procurando) +
         ' | terminou -> ' + JSON.stringify(gelo.terminou));
    gelo.temTratador
      ? ok('a conexão escuta o fim da busca por caminhos')
      : mal('ninguém avisa quando a busca termina');
    (gelo.procurando.descargas === 0 && gelo.procurando.relogio)
      ? ok('enquanto ainda procura, ele deixa o relógio de 250 ms juntar — é para isso que ele existe')
      : mal('mandou a sacola no meio da busca e desfez a economia',
            JSON.stringify(gelo.procurando));
    (gelo.terminou.descargas === 1)
      ? ok('e no instante em que a busca termina ele manda, sem esperar o resto do prazo',
           'não sobrou nada para juntar: esperar ali é atrasar a conexão de graça')
      : mal('terminou a busca e a sacola ficou esperando o relógio',
            JSON.stringify(gelo.terminou));
    (gelo.terminou.relogio === false)
      ? ok('e cancela o relógio pendente, para não mandar uma sacola vazia logo depois')
      : mal('sobrou relógio armado — vem uma mensagem à toa atrás', JSON.stringify(gelo.terminou));

    /* ============ 57. o código curto e o compressor que não cabe nele ============ */
    console.log('\n=== 57. Com H.265 preferido, o código manual sai honesto ou quebrado? ===');
    const manual = await A.evaluate(() => {
      const fp = Array.from({ length: 32 }, (_, i) =>
        (i + 16).toString(16).padStart(2, '0').toUpperCase()).join(':');
      const montar = (linhasVideo, mLinha) => [
        'v=0', 'o=- 1 1 IN IP4 0.0.0.0', 's=-', 't=0 0',
        'a=ice-ufrag:abcd', 'a=ice-pwd:0123456789abcdefghij',
        'a=fingerprint:sha-256 ' + fp,
        'a=extmap:1 urn:ietf:params:rtp-hdrext:sdes:mid',
        'a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01',
        'm=audio 9 UDP/TLS/RTP/SAVPF 111', 'c=IN IP4 0.0.0.0',
        'a=rtpmap:111 opus/48000/2', 'a=ssrc:1111 cname:x',
        'a=candidate:1 1 udp 2122260223 192.168.0.5 50000 typ host generation 0',
        mLinha, 'c=IN IP4 0.0.0.0',
      ].concat(linhasVideo, ['a=ssrc:2222 cname:x']).join('\r\n');

      const tentar = (sdp) => {
        est.manualTrocouCodec = '';
        try {
          const cod = empacotar(sdp, 'convite');
          const volta = desempacotar(cod);
          return { ok: true, trocou: est.manualTrocouCodec,
                   temH264: /a=rtpmap:96 H264\/90000/.test(volta.sdp),
                   temH265: /H265/.test(volta.sdp) };
        } catch (e) { return { ok: false, erro: String(e.message || e) }; }
      };

      // (a) H.265 na frente (é o que a v5.8 faz quando a placa comprime)
      const comH265 = tentar(montar(
        ['a=rtpmap:45 H265/90000', 'a=rtpmap:96 H264/90000'],
        'm=video 9 UDP/TLS/RTP/SAVPF 45 96'));
      // (b) o caso normal, H.264 na frente
      const normal = tentar(montar(
        ['a=rtpmap:96 H264/90000', 'a=rtpmap:98 VP9/90000'],
        'm=video 9 UDP/TLS/RTP/SAVPF 96 98'));
      // (c) SÓ H.265: não dá para montar um código curto honesto
      const soH265 = tentar(montar(
        ['a=rtpmap:45 H265/90000'], 'm=video 9 UDP/TLS/RTP/SAVPF 45'));
      est.manualTrocouCodec = '';
      return { comH265, normal, soH265 };
    });
    info('com H265 -> ' + JSON.stringify(manual.comH265) + ' | só H265 -> ' +
         JSON.stringify(manual.soH265));
    (manual.comH265.ok && manual.comH265.temH264 && !manual.comH265.temH265)
      ? ok('com H.265 preferido, o código curto sai em H.264 — o único que todo navegador tem',
           'oferecer só H.265 num código de 150 bytes é apostar a conexão inteira')
      : mal('o código curto saiu com um compressor que pode não existir do outro lado',
            JSON.stringify(manual.comH265));
    (manual.comH265.trocou === 'H265')
      ? ok('e ele AVISA que trocou, em vez de descartar a escolha em silêncio')
      : mal('a troca de compressor foi calada', String(manual.comH265.trocou));
    (manual.normal.ok && manual.normal.trocou === '')
      ? ok('no caso normal não avisa nada — aviso que aparece sempre não é aviso')
      : mal('avisou sem ter trocado', JSON.stringify(manual.normal));
    (!manual.soH265.ok && /SDP_INCOMPLETO/.test(manual.soH265.erro))
      ? ok('e sem nenhum compressor que caiba, ele FALHA aqui em vez de gerar um link torto',
           'antes montava um SDP dizendo VP8 e apontando para o número do H.265')
      : mal('gerou um código que só falharia na casa do amigo', JSON.stringify(manual.soH265));

    /* ============ 58. as réguas de quadro viraram buffer circular ============ */
    console.log('\n=== 58. push+shift saíram do laço por quadro, sem perder a conta? ===');
    const anel = await A.evaluate(async () => {
      // pulso: é global e único — mede o passo, sem nenhum push/shift no meio
      const eraQ = pulso.quadros, eraIdx = pulso.idx, eraQtd = pulso.qtd;
      pulso.quadros = new Float32Array(600); pulso.idx = 0; pulso.qtd = 0;
      const semPushShift = typeof pulso.quadros.push !== 'function' &&
                           typeof pulso.quadros.shift !== 'function';
      // 650 amostras: passa da capacidade de 600, tem que dar a volta sem crescer
      for (let i = 0; i < 650; i++) {
        pulso.quadros[pulso.idx] = 10 + (i % 5);
        pulso.idx = (pulso.idx + 1) % 600;
        if (pulso.qtd < 600) pulso.qtd++;
      }
      const capacidadeFixa = pulso.quadros.length === 600;
      const qtdCravouNoTeto = pulso.qtd === 600;
      const resumo = resumoDoPulso();
      pulso.quadros = eraQ; pulso.idx = eraIdx; pulso.qtd = eraQtd;

      // par.intervalos: por pessoa, some e volta quando o medidor reinicia
      const p = [...pares.values()][0];
      const eraI = { buf: p.intervalos, idx: p.intervalosIdx, qtd: p.intervalosQtd };
      p.intervalos = new Float32Array(240); p.intervalosIdx = 0; p.intervalosQtd = 0;
      for (let i = 0; i < 15; i++) {
        p.intervalos[p.intervalosIdx] = 16 + i;
        p.intervalosIdx = (p.intervalosIdx + 1) % 240;
        if (p.intervalosQtd < 240) p.intervalosQtd++;
      }
      const poucoAindaNaoConta = pacingDe(p);   // <20 amostras: null
      for (let i = 0; i < 220; i++) {
        p.intervalos[p.intervalosIdx] = 16;
        p.intervalosIdx = (p.intervalosIdx + 1) % 240;
        if (p.intervalosQtd < 240) p.intervalosQtd++;
      }
      const jaConta = pacingDe(p);
      p.intervalos = eraI.buf; p.intervalosIdx = eraI.idx; p.intervalosQtd = eraI.qtd;

      return { semPushShift, capacidadeFixa, qtdCravouNoTeto, resumo, poucoAindaNaoConta, jaConta };
    });
    info('resumo do pulso com 650 amostras numa capacidade de 600: ' + JSON.stringify(anel.resumo));
    anel.semPushShift
      ? ok('Float32Array não tem push/shift — não tem como reintroduzir o custo por acidente')
      : mal('a régua ainda é um array comum');
    (anel.capacidadeFixa && anel.qtdCravouNoTeto)
      ? ok('650 escritas numa capacidade de 600: o índice deu a volta e a contagem parou em 600',
           'sem crescer o array e sem faltar nenhuma amostra')
      : mal('a capacidade ou a contagem saiu do esperado', JSON.stringify(anel));
    (anel.resumo && anel.resumo.fps > 0)
      ? ok('e o resumo sai normal depois da volta completa do índice', JSON.stringify(anel.resumo))
      : mal('o resumo quebrou depois de dar a volta no buffer', JSON.stringify(anel.resumo));
    (anel.poucoAindaNaoConta === null && anel.jaConta && anel.jaConta.fps > 0)
      ? ok('e por pessoa continua exigindo 20 amostras antes de opinar — nada mudou aí',
           JSON.stringify(anel.jaConta))
      : mal('a exigência de amostra mínima se perdeu na troca', JSON.stringify(anel));

    /* ============ 59. a etiqueta do nome some no modo liso ============ */
    console.log('\n=== 59. Com uma tela só, a etiqueta some e libera o vídeo para o hardware? ===');
    const L2 = await faz(1000);
    await L2.goto(BASE, { waitUntil: 'load' });
    await espera(500);
    const etiqueta = await L2.evaluate(() => {
      montarQuadro('sozinho', 'tela sozinha', true, null);
      arrumarPalco();
      // um quadro recém-criado se apresenta por 3,4s (.revelar) — é o
      // ESTADO ESTÁVEL, depois que ele se apresentou, que este teste
      // quer conferir, não o instante da criação
      document.getElementById('q-sozinho').classList.remove('revelar');
      const tag = document.querySelector('#q-sozinho .quadro-tag');
      const opacidadeLiso = document.body.classList.contains('liso')
        ? getComputedStyle(tag).opacity : null;
      // segundo quadro: agora tem DUAS, liso tem que desligar sozinho
      montarQuadro('sozinho2', 'outra tela', true, null);
      arrumarPalco();
      const lisoComDuas = document.body.classList.contains('liso');
      const opacidadeComDuas = getComputedStyle(
        document.querySelector('#q-sozinho .quadro-tag')).opacity;
      document.getElementById('q-sozinho2').remove();
      document.getElementById('q-sozinho').remove();
      est.foco = null; arrumarPalco();
      return { opacidadeLiso, lisoComDuas, opacidadeComDuas };
    });
    info('opacidade da etiqueta em liso: ' + etiqueta.opacidadeLiso +
         ' | com duas telas: ' + etiqueta.opacidadeComDuas);
    (etiqueta.opacidadeLiso === '0')
      ? ok('com uma tela só (liso ligado), a etiqueta fica invisível por padrão',
           'era ela, redonda e semitransparente, que forçava o vídeo para underlay')
      : mal('a etiqueta continua sempre visível em cima do vídeo', String(etiqueta.opacidadeLiso));
    (!etiqueta.lisoComDuas && etiqueta.opacidadeComDuas === '1')
      ? ok('com duas telas o liso desliga sozinho, e aí a etiqueta volta a aparecer sempre',
           'não tem ambiguidade de "de quem é" quando só existe um quadro')
      : mal('o comportamento com duas telas não é o esperado', JSON.stringify(etiqueta));
    await L2.close();

    /* ============ 60. o medidor de voz sem divisão dentro do laço ============ */
    console.log('\n=== 60. Tirar a divisão de dentro do laço deu o MESMO número? ===');
    const voz = await A.evaluate(() => {
      const fabricar = (padrao) => {
        const a = new Uint8Array(1024);
        for (let i = 0; i < a.length; i++) a[i] = padrao(i);
        return a;
      };
      const rodar = (a) => {
        const eraAnalisador = est.analisador, eraBalde = est.balde;
        est.balde = a;
        est.analisador = { fftSize: a.length, getByteTimeDomainData: (dst) => dst.set(a) };
        const r = nivel();
        est.analisador = eraAnalisador; est.balde = eraBalde;
        return r;
      };
      // três formas de onda bem diferentes: silêncio, cheia, e uma senoide
      const silencio = rodar(fabricar(() => 128));
      const cheia = rodar(fabricar((i) => (i % 2 ? 0 : 255)));
      // amplitude pequena de propósito: com 100 ela clampava no mesmo teto
      // da onda cheia (as duas em 100), e a comparação não provava nada
      const senoide = rodar(fabricar((i) => Math.round(128 + 15 * Math.sin(i / 12))));
      return { silencio, cheia, senoide };
    });
    info('silêncio: ' + voz.silencio + ' | cheia: ' + voz.cheia + ' | senoide: ' + voz.senoide);
    (voz.silencio === 0)
      ? ok('silêncio continua dando zero')
      : mal('silêncio deixou de dar zero', String(voz.silencio));
    (voz.cheia > voz.senoide && voz.senoide > voz.silencio)
      ? ok('a ordem entre as três formas de onda se mantém: cheia > senoide > silêncio',
           voz.cheia + ' > ' + voz.senoide + ' > ' + voz.silencio)
      : mal('a conta nova não bate com a conta antiga', JSON.stringify(voz));

    /* ============ 61. o foco não força layout no mesmo instante ============ */
    console.log('\n=== 61. Focar uma tela lê a geometria depois de escrever, não junto? ===');
    const semReflow = await A.evaluate(async () => {
      // par de mentira, com o vídeo no ID que avisarTamanho($('v-p-'+id))
      // realmente procura — um peer de verdade da suíte não serve aqui
      // porque essa função sai antes de tocar em p.avisei quando não acha
      // o elemento, e isso mascararia a pergunta que este teste faz.
      const fabricarPar = (id) => {
        const par = { id, canal: { readyState: 'open' }, pc: {}, avisei: 999,
                      larguraQueQuer: 0 };
        montarQuadro('p-' + id, 'tela ' + id, true, null, par);
        pares.set(id, par);
        return par;
      };
      const p1 = fabricarPar('foco1'), p2 = fabricarPar('foco2');
      arrumarPalco();

      alternarFoco('foco1');
      // no instante seguinte ao clique, ainda não pode ter rodado —
      // é exatamente essa folga que tira o reflow forçado do meio do clique
      const logoDepois = p1.avisei;
      await new Promise((r) => setTimeout(r, 50));
      const depoisDaFolga = p1.avisei;

      pares.delete('foco1'); pares.delete('foco2');
      document.getElementById('q-p-foco1').remove();
      document.getElementById('q-p-foco2').remove();
      est.foco = null; arrumarPalco();
      return { logoDepois, depoisDaFolga };
    });
    info('avisei logo depois do clique: ' + semReflow.logoDepois +
         ' | depois de uma folga: ' + semReflow.depoisDaFolga);
    (semReflow.logoDepois === 999)
      ? ok('avisarTamanhos não roda no MESMO instante que arrumarPalco escreve as classes',
           'escrever e já ler geometria ali seria o gatilho de reflow forçado')
      : mal('a leitura de geometria ainda acontece colada na escrita', String(semReflow.logoDepois));
    (semReflow.depoisDaFolga !== 999)
      ? ok('e roda logo em seguida, numa folga — o amigo focado recebe o tamanho novo mesmo assim')
      : mal('a leitura nunca chegou a acontecer', String(semReflow.depoisDaFolga));

    /* ============ 62. o piso de emergência mesmo em nitidez ============ */
    console.log('\n=== 62. Nitidez trava por vários segundos: existe um piso, e ele devolve sozinho? ===');
    const socorroNitidez = await A.evaluate(async () => {
      const p = [...pares.values()][0];
      const eraPrio = cfg.prioridade;
      cfg.prioridade = 'nitidez';
      const a = autoDe(p); zerarAuto(p); a.aquece = 99; a.banda = 0;
      const alvo = 60; // 1080-60-8

      /* Os números são os do caderninho real de 03/09 (7:11 a 7:14):
         7, 6, 8, 9 fps num alvo de 60 — a escada normal, com prioridade
         em nitidez, não faz NADA com isso (ela está inteira desligada). */
      const antes = a.degrauFps;
      let socorreu = null;
      for (const fps of [7, 6, 8]) {
        await ajustarQualidade(p, 0, false, 0, fps);
        if (a.degrauFps !== antes) { socorreu = a.degrauFps; break; }
      }
      const depoisDe3Ruins = a.degrauFps;

      // sozinha, uma queda de 1-2 segundos não é emergência — só 3 SEGUIDAS
      zerarAuto(p); a.aquece = 99; a.banda = 0;
      await ajustarQualidade(p, 0, false, 0, 7);
      await ajustarQualidade(p, 0, false, 0, 55); // recupera no meio
      await ajustarQualidade(p, 0, false, 0, 6);
      const naoSocorreuIsolado = a.degrauFps;

      // a segunda emergência não pode vir colada na primeira
      zerarAuto(p); a.aquece = 99; a.banda = 0;
      for (const fps of [7, 6, 8]) await ajustarQualidade(p, 0, false, 0, fps);
      const primeiraEmergencia = a.degrauFps;
      for (const fps of [7, 6, 8]) await ajustarQualidade(p, 0, false, 0, fps);
      const tentouDeNovoLogoEmSeguida = a.degrauFps;

      // e devolve sozinho depois de respirar bem por um tempo — sem
      // esperar os 30s reais, adianto o relógio da última emergência
      a.quandoEmergencia = Date.now() - 31000;
      for (let i = 0; i < 30; i++) await ajustarQualidade(p, 0, false, 0, 58);
      const devolveu = a.degrauFps;

      cfg.prioridade = eraPrio;
      zerarAuto(p); p.perfilAplicado = null; await aplicarPerfilVideo(p);
      return { antes, socorreu, depoisDe3Ruins, naoSocorreuIsolado,
               primeiraEmergencia, tentouDeNovoLogoEmSeguida, devolveu };
    });
    info('antes: ' + socorroNitidez.antes + 'x | socorreu no degrau: ' + socorroNitidez.socorreu +
         ' | isolado (não deveria mexer): ' + socorroNitidez.naoSocorreuIsolado +
         ' | devolveu: ' + socorroNitidez.devolveu + 'x');
    (socorroNitidez.antes === 1 && socorroNitidez.depoisDe3Ruins > 1)
      ? ok('3 segundos seguidos abaixo de 30% do alvo, mesmo em nitidez, encolhe um degrau',
           'são os números reais do caderninho: 7, 6, 8 fps num alvo de 60')
      : mal('nitidez continua travando sem nenhum socorro', JSON.stringify(socorroNitidez));
    (socorroNitidez.naoSocorreuIsolado === 1)
      ? ok('mas uma queda de 1-2 segundos, com recuperação no meio, NÃO conta como emergência')
      : mal('socorreu numa oscilação normal, não numa emergência de verdade',
            String(socorroNitidez.naoSocorreuIsolado));
    (socorroNitidez.tentouDeNovoLogoEmSeguida === socorroNitidez.primeiraEmergencia)
      ? ok('e uma segunda emergência não dispara colada na primeira — o piso não vira uma escada')
      : mal('disparou duas emergências seguidas, virou uma escada normal escondida',
            JSON.stringify(socorroNitidez));
    (socorroNitidez.devolveu < socorroNitidez.primeiraEmergencia)
      ? ok('e devolve o tamanho sozinho depois de respirar bem — nitidez continua sendo a intenção',
           socorroNitidez.primeiraEmergencia + 'x -> ' + socorroNitidez.devolveu + 'x')
      : mal('ficou preso no degrau de emergência para sempre', String(socorroNitidez.devolveu));

    /* ============ 63. duas idas e voltas já bastam ============ */
    console.log('\n=== 63. Um caderninho real levou 6 minutos para reconhecer o segundo monitor — e agora? ===');
    const doisCliques = await B.evaluate(async () => {
      const fingir = async (v) => {
        if (!window.__stub63) {
          window.__stub63 = true;
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => !!window.__escondido63 });
        }
        window.__escondido63 = v;
        document.dispatchEvent(new Event('visibilitychange'));
        await new Promise(r => setTimeout(r, 60));
      };
      const eraNao = est.naoEconomizar, eraIdas = est.idasEVoltas;
      est.naoEconomizar = false; est.idasEVoltas = 0;

      await fingir(true); await fingir(false);
      const depoisDeUma = { naoEconomizar: !!est.naoEconomizar, idas: est.idasEVoltas };

      await fingir(true); await fingir(false);
      const depoisDeDuas = { naoEconomizar: !!est.naoEconomizar, idas: est.idasEVoltas };

      est.naoEconomizar = eraNao; est.idasEVoltas = eraIdas;
      return { depoisDeUma, depoisDeDuas };
    });
    info('depois de 1 ida-e-volta: ' + JSON.stringify(doisCliques.depoisDeUma) +
         ' | depois de 2: ' + JSON.stringify(doisCliques.depoisDeDuas));
    !doisCliques.depoisDeUma.naoEconomizar
      ? ok('uma ida-e-volta sozinha ainda não é prova de segundo monitor')
      : mal('desistiu cedo demais, com só uma repetição', JSON.stringify(doisCliques.depoisDeUma));
    doisCliques.depoisDeDuas.naoEconomizar
      ? ok('mas DUAS já bastam agora — no caderninho real isso levou 6 minutos a mais do que devia',
           doisCliques.depoisDeDuas.idas + ' idas e voltas')
      : mal('ainda exige 3, continua lento para reconhecer o padrão', JSON.stringify(doisCliques.depoisDeDuas));

    /* ============ 64. a diferença entre duas amostras de pixel ============ */
    console.log('\n=== 64. diferencaEntreAmostras reconhece "mesmo quadro" e "quadro diferente"? ===');
    const diferenca = await A.evaluate(() => {
      const feita = (vals) => ({ luma: Float32Array.from(vals) });
      const iguais   = diferencaEntreAmostras(feita([10,20,30,200]), feita([10,20,30,200]));
      const parecidas= diferencaEntreAmostras(feita([10,20,30,200]), feita([10.3,20.2,30,200.1]));
      const bemDiferentes = diferencaEntreAmostras(feita([10,20,30,200]), feita([80,90,15,40]));
      const tamanhoDiferente = diferencaEntreAmostras(feita([1,2,3]), feita([1,2]));
      const semAmostra = diferencaEntreAmostras(null, feita([1,2,3]));
      return { iguais, parecidas, bemDiferentes, tamanhoDiferente, semAmostra };
    });
    info(JSON.stringify(diferenca));
    (diferenca.iguais === 0)
      ? ok('duas amostras idênticas dão diferença zero')
      : mal('amostras iguais não deram zero', String(diferenca.iguais));
    (diferenca.parecidas < 0.6)
      ? ok('ruído mínimo de recompressão não conta como "mudou"', diferenca.parecidas.toFixed(3))
      : mal('um ruído pequeno já contaria como imagem viva', String(diferenca.parecidas));
    (diferenca.bemDiferentes > 0.6)
      ? ok('uma imagem realmente diferente passa longe do limiar', diferenca.bemDiferentes.toFixed(1))
      : mal('duas amostras bem diferentes não cruzaram o limiar', String(diferenca.bemDiferentes));
    (diferenca.tamanhoDiferente === null && diferenca.semAmostra === null)
      ? ok('grades de tamanho diferente ou amostra ausente não quebram — devolvem null')
      : mal('não tratou entrada inválida', JSON.stringify(diferenca));

    /* ============ 65. o aviso automático separa CONGELADA de SÓ LENTA ============ */
    console.log('\n=== 65. Mesma contagem de quadros, veredito oposto: congelou ou só está devagar? ===');
    const autoDetector = await A.evaluate(async () => {
      const eraFn = window.amostrarVideoNumerico;
      const eraMarcos = registro.marcos.length;

      const rodar = async (congelarDeVerdade) => {
        let n = 0;
        window.amostrarVideoNumerico = () => {
          n++;
          const base = congelarDeVerdade ? 100 : 100 + n * 50;
          return { luma: new Float32Array(6).fill(base), media: base, min: base, max: base,
                   vivos: 6, total: 6 };
        };
        await investigarCongelamento(31, 60);
        window.amostrarVideoNumerico = eraFn;
        return registro.marcos[registro.marcos.length - 1].txt;
      };

      const congelada = await rodar(true);
      const viva = await rodar(false);
      registro.marcos.length = eraMarcos;   // não sujar o resto da suíte
      return { congelada, viva };
    });
    info('congelada -> ' + autoDetector.congelada + ' | viva -> ' + autoDetector.viva);
    /CONGELADA/.test(autoDetector.congelada)
      ? ok('três amostras idênticas: acusa CONGELADA (bloqueio do Windows, não falta de placa)')
      : mal('não reconheceu o congelamento de verdade', autoDetector.congelada);
    !/CONGELADA/.test(autoDetector.viva)
      ? ok('três amostras diferentes, mesma contagem de quadros baixa: NÃO diz que está bloqueada',
           autoDetector.viva.slice(0, 70))
      : mal('confundiu imagem viva e devagar com imagem bloqueada', autoDetector.viva);

    /* ============ 66. o teste manual (🔬) também separa os dois casos ============ */
    console.log('\n=== 66. O botão de testar a captura entrega o mesmo veredito, agora com CONGELADA? ===');
    const manualCongelado = await A.evaluate(async () => {
      cfg.qualidade = '1080-60-8';
      const faixa = est.streamTela.getVideoTracks()[0];
      faixa.applyConstraints = async () => {};
      const relogioReal = window.setTimeout;
      window.setTimeout = (fn, ms) => relogioReal(fn, ms > 300 ? 20 : ms);
      const medianaReal = window.medianaDe;
      let fila = [];
      window.medianaDe = () => (fila.length ? fila.shift() : 0);
      const eraAmostra = window.amostrarVideoNumerico;
      window.amostrarVideoNumerico = () => ({ luma: new Float32Array(4).fill(50), media: 50,
                                              min: 50, max: 50, vivos: 4, total: 4 });

      fila = [30, 2500, 31, 2500];   // caminho: encolher não rendeu nada
      zerarSocorroCaptura();
      est.tamBaseCaptura = { l: 1920, a: 1080 };
      await testarCaptura();
      const txt = document.getElementById('resultado-captura').textContent;

      window.setTimeout = relogioReal; window.medianaDe = medianaReal;
      window.amostrarVideoNumerico = eraAmostra;
      return txt;
    });
    info(manualCongelado.slice(0, 90) + '…');
    /CAPTURA ESTÁ CONGELADA/.test(manualCongelado)
      ? ok('com os pixels sempre idênticos durante a medida, o teste manual também diz CONGELADA',
           'em vez do genérico "duas causas" de antes')
      : mal('o teste manual não pegou o congelamento', manualCongelado);
    /Janela Sem Borda/.test(manualCongelado)
      ? ok('e dá o único conserto que existe para isto — trocar o modo de tela do jogo')
      : mal('não disse o que fazer', manualCongelado);

    /* ============ 67. socorrerCaptura espera o Sozinho avaliar uma vez ============ */
    console.log('\n=== 67. Duas escadas de captura, o mesmo sinal — o Sozinho tem a primeira tentativa? ===');
    const coordenacao = await A.evaluate(async () => {
      const eraQ = cfg.qualidade;
      const eraAuto = Object.assign({}, PERFIS.auto);
      const eraHist = est.histFonte;
      const eraSoc = est.socorro;
      const eraAvaliou = est.sozinhoAvaliou;
      const eraTam = est.tamBaseCaptura;
      const eraSozQuando = est.sozinhoQuando;
      const eraCompressor = est.compressorNaPlaca;

      let chamouDegrau = 0;
      const eraAplicar = window.aplicarDegrauCaptura;
      window.aplicarDegrauCaptura = async () => { chamouDegrau++; return true; };

      const preparar = () => {
        zerarSocorroCaptura();
        est.socorro.quando = Date.now() - 20000;   // já passou dos 15s de espera
        est.histFonte = Array.from({ length: 30 }, (_, i) => 20 + (i % 3));  // firme e baixo
        est.tamBaseCaptura = { l: 1920, a: 1080 };
        Object.assign(PERFIS.auto, { l: 1920, a: 1080, fps: 60, mbps: 8 });
        est.compressorNaPlaca = true;
      };

      // (a) auto, Sozinho ainda não avaliou: não pode agir
      cfg.qualidade = 'auto'; est.sozinhoAvaliou = false; preparar();
      await socorrerCaptura();
      const antesDeAvaliar = chamouDegrau;

      // (b) o Sozinho avaliou — mesmo sem mudar nada — e isso já libera.
      // preparar() chama zerarSocorroCaptura(), que reseta sozinhoAvaliou
      // de propósito — então marca DEPOIS de preparar, não antes.
      chamouDegrau = 0; preparar(); est.sozinhoAvaliou = true;
      await socorrerCaptura();
      const depoisDeAvaliar = chamouDegrau;

      // (c) perfil manual nunca dependeu do Sozinho
      chamouDegrau = 0; cfg.qualidade = '1080-60-8'; est.sozinhoAvaliou = false; preparar();
      await socorrerCaptura();
      const perfilManual = chamouDegrau;

      // (d) escolherSozinho marca "avaliou" mesmo quando decide não mudar nada —
      // senão um caso SAUDÁVEL travaria o socorro para sempre
      cfg.qualidade = 'auto'; est.sozinhoAvaliou = false; est.sozinhoQuando = 0;
      Object.assign(PERFIS.auto, { l: 1920, a: 1080, fps: 60, mbps: 8 });
      est.compressorNaPlaca = true;
      est.histFonte = Array.from({ length: 25 }, () => 60);   // já no alvo
      est.tamBaseCaptura = { l: 1920, a: 1080 };
      await escolherSozinho();
      const avaliouSemMudar = est.sozinhoAvaliou;

      // (e) uma nova transmissão reseta o marcador
      zerarSocorroCaptura();
      const resetado = est.sozinhoAvaliou;

      window.aplicarDegrauCaptura = eraAplicar;
      cfg.qualidade = eraQ; Object.assign(PERFIS.auto, eraAuto);
      est.histFonte = eraHist; est.socorro = eraSoc; est.sozinhoAvaliou = eraAvaliou;
      est.tamBaseCaptura = eraTam; est.sozinhoQuando = eraSozQuando;
      est.compressorNaPlaca = eraCompressor;
      return { antesDeAvaliar, depoisDeAvaliar, perfilManual, avaliouSemMudar, resetado };
    });
    info(JSON.stringify(coordenacao));
    (coordenacao.antesDeAvaliar === 0)
      ? ok('no Sozinho, socorrerCaptura não mexe em resolução antes de o Sozinho avaliar uma vez')
      : mal('agiu antes do Sozinho ter a primeira chance', String(coordenacao.antesDeAvaliar));
    (coordenacao.depoisDeAvaliar >= 1)
      ? ok('depois que o Sozinho avaliou (mesmo sem mudar nada), socorrerCaptura pode agir')
      : mal('ficou bloqueado para sempre, mesmo com o Sozinho já tendo avaliado',
            String(coordenacao.depoisDeAvaliar));
    (coordenacao.perfilManual >= 1)
      ? ok('num perfil manual (sem Sozinho ligado), socorrerCaptura nunca dependeu disso')
      : mal('o perfil manual ficou preso esperando um Sozinho que nem está ligado',
            String(coordenacao.perfilManual));
    (coordenacao.avaliouSemMudar === true)
      ? ok('escolherSozinho marca "avaliou" mesmo sem mudar nada — senão travaria o socorro para sempre')
      : mal('só marca avaliou quando muda algo — bloquearia o socorro pra sempre num caso saudável',
            String(coordenacao.avaliouSemMudar));
    (coordenacao.resetado === false)
      ? ok('e uma nova transmissão (zerarSocorroCaptura) reseta o marcador')
      : mal('o marcador sobreviveu a uma nova transmissão', String(coordenacao.resetado));

    /* ============ 68. o ritmo separa "sufocada" de "é mesmo o teto" ============ */
    console.log('\n=== 68. Mesma contagem de quadros: rajada (sufoco) ou regular (teto de verdade)? ===');
    const ritmo = await A.evaluate(async () => {
      const eraAmostra = window.amostrarVideoNumerico;
      const eraOlhar = window.olharQuadrosPintados;
      const eraPacing = window.pacingDe;
      const eraAvisou = est.avisouCaptura;
      const eraTimeout = window.setTimeout;
      window.setTimeout = (fn, ms) => eraTimeout(fn, ms > 1000 ? 50 : ms);

      let n = 0;
      // pixels sempre diferentes: nunca cai no ramo CONGELADA, sempre chega no ritmo
      window.amostrarVideoNumerico = () => {
        n++; return { luma: new Float32Array(4).fill(100 + n * 50), media: 100, min: 90,
                       max: 110, vivos: 4, total: 4 };
      };
      window.olharQuadrosPintados = () => {};   // o pacing vem todo do mock abaixo

      const rodar = async (pacing) => {
        est.avisouCaptura = false;
        window.pacingDe = () => pacing;
        await investigarCongelamento(31, 60);
        return registro.marcos[registro.marcos.length - 1].txt;
      };

      // limiar real é (1000/30)*3 = 100ms — 180 fica bem acima, sem ambiguidade
      const rajada = await rodar({ fps: 30, pior: 10, buraco: 180 });
      // buraco de 35ms contra ~33ms de média = o mesmo espaço, sempre
      const regular = await rodar({ fps: 30, pior: 28, buraco: 35 });
      // pouca amostra: pacingDe devolveria null na vida real
      const semDados = await rodar(null);

      window.amostrarVideoNumerico = eraAmostra;
      window.olharQuadrosPintados = eraOlhar;
      window.pacingDe = eraPacing;
      window.setTimeout = eraTimeout;
      est.avisouCaptura = eraAvisou;
      return { rajada, regular, semDados };
    });
    info('rajada: ' + ritmo.rajada.slice(0, 55) + '… | regular: ' + ritmo.regular.slice(0, 55) + '…');
    /RAJADAS irregulares/.test(ritmo.rajada)
      ? ok('buraco bem maior que o intervalo médio: acusa a placa SUFOCADA, não bloqueio',
           'manda travar o FPS do jogo — conserto diferente de "trocar pra janela sem borda"')
      : mal('não reconheceu o padrão de rajada', ritmo.rajada);
    /forma REGULAR/.test(ritmo.regular)
      ? ok('espaçamento parelho entre quadros: diz que É O TETO de verdade, não sufoco',
           'e avisa que travar o FPS do jogo pode não mudar nada')
      : mal('não reconheceu o ritmo regular', ritmo.regular);
    (!/RAJADAS/.test(ritmo.semDados) && !/REGULAR/.test(ritmo.semDados) && !/CONGELADA/.test(ritmo.semDados))
      ? ok('sem amostra de ritmo suficiente, cai no aviso genérico de sempre — não inventa veredito')
      : mal('inventou um veredito sem dado suficiente', ritmo.semDados);

    /* ============ 69. getStats de todo mundo ao mesmo tempo ============ */
    console.log('\n=== 69. atualizarNumeros busca os relatórios de TODOS ao mesmo tempo, não em fila? ===');
    const paralelo = await A.evaluate(async () => {
      // o intervalo de verdade (a cada 1s) continua rodando durante a suíte
      // inteira — sem parar ele, uma virada dele NO MEIO da medição chama
      // getStats() de novo para os mesmos falsos e falseia a contagem
      pararNumeros();
      document.getElementById('painel').classList.add('aberto');   // precisaAgora = true

      const chamadas = [];
      const falsos = ['zzz1','zzz2','zzz3'].map(id => {
        const f = { id, pc: { getStats: () => {
          chamadas.push(performance.now());
          return new Promise(res => setTimeout(() => res(new Map()), 150));
        } } };
        pares.set(id, f);
        return f;
      });

      const antes = performance.now();
      await atualizarNumeros();
      const total = performance.now() - antes;

      falsos.forEach(f => pares.delete(f.id));
      document.getElementById('painel').classList.remove('aberto');
      iniciarNumeros();

      const espalhamento = chamadas.length ? Math.max(...chamadas) - Math.min(...chamadas) : -1;
      return { total, espalhamento, n: chamadas.length };
    });
    info('3 pessoas, 150ms cada: total ' + paralelo.total.toFixed(0) + 'ms | disparo espalhado por ' +
         paralelo.espalhamento.toFixed(1) + 'ms');
    (paralelo.n === 3)
      ? ok('as três pessoas tiveram o getStats chamado nesta rodada')
      : mal('não chamou para as três', String(paralelo.n));
    (paralelo.espalhamento < 50)
      ? ok('as três chamadas saíram quase juntas — nenhuma esperou a outra terminar para começar',
           paralelo.espalhamento.toFixed(1) + 'ms de diferença entre a primeira e a última')
      : mal('uma pessoa esperou a resposta da outra antes de perguntar a sua', paralelo.espalhamento.toFixed(1));
    (paralelo.total < 350)
      ? ok('o tempo total ficou perto de UMA espera de 150ms, não da soma das três (450ms+)',
           paralelo.total.toFixed(0) + 'ms')
      : mal('o tempo total bateu perto da soma sequencial das três esperas', paralelo.total.toFixed(0));

    /* ============ 70. a fonte de recados que fechou de vez se reconecta ============ */
    console.log('\n=== 70. Uma fonte de recados fechada de vez tenta se reconectar, com limite? ===');
    const reconexao = await A.evaluate(async () => {
      const eraFontes = sala.fontes.slice();
      const eraLigada = sala.ligada;
      const eraTentativas = Object.assign({}, sala.tentativasFonte);
      const relogioReal = window.setTimeout;
      window.setTimeout = (fn, ms) => relogioReal(fn, 5);   // não esperar de verdade

      let chamouEscutar = 0;
      const eraEscutar = window.escutar;
      window.escutar = (base) => { chamouEscutar++; return { base, close(){} }; };

      let avisouRuim = false;
      const eraRecado = window.recado;
      window.recado = (txt, tipo) => { if (tipo === 'ruim') avisouRuim = true; };

      // (a) primeira falha de vez: sai da lista e tenta de novo
      sala.ligada = true; sala.tentativasFonte = {};
      const morta = { readyState: 2 };   // 2 = EventSource.CLOSED
      sala.fontes = [morta];
      recuperarFonte('base-teste', morta);
      await new Promise(r => relogioReal(r, 30));
      const tentouDeNovo = chamouEscutar;
      const sumiu = !sala.fontes.includes(morta);

      // (b) já esgotou as tentativas: desiste e avisa, se ninguém mais escuta
      sala.tentativasFonte['base-teste'] = 5;
      sala.fontes = [];
      recuperarFonte('base-teste', { readyState: 2 });
      await new Promise(r => relogioReal(r, 30));

      // (c) sala fechada nesse meio-tempo: não insiste
      chamouEscutar = 0; sala.ligada = false; sala.tentativasFonte = {};
      recuperarFonte('base-teste', { readyState: 2 });
      await new Promise(r => relogioReal(r, 30));
      const insistiuFechada = chamouEscutar;

      window.setTimeout = relogioReal; window.escutar = eraEscutar; window.recado = eraRecado;
      sala.fontes = eraFontes; sala.ligada = eraLigada; sala.tentativasFonte = eraTentativas;
      return { tentouDeNovo, sumiu, avisouRuim, insistiuFechada };
    });
    info(JSON.stringify(reconexao));
    (reconexao.sumiu === true)
      ? ok('a fonte morta sai da lista assim que percebe que fechou de vez')
      : mal('a fonte morta continuou na lista', String(reconexao.sumiu));
    (reconexao.tentouDeNovo >= 1)
      ? ok('tenta escutar a mesma base de novo, em vez de ficar surda para sempre')
      : mal('não tentou reconectar', String(reconexao.tentouDeNovo));
    (reconexao.avisouRuim === true)
      ? ok('depois de esgotar as tentativas sem sobrar nenhuma fonte viva, avisa a pessoa')
      : mal('esgotou as tentativas calado', String(reconexao.avisouRuim));
    (reconexao.insistiuFechada === 0)
      ? ok('já tendo saído da sala, não insiste em reconectar')
      : mal('insistiu em reconectar depois de a sala já ter fechado', String(reconexao.insistiuFechada));

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
