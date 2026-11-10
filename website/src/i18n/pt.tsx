import { Fig } from '@/components/fig';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { DOWNLOAD_URL, REPO_URL } from '@/lib/site';
import type { Messages } from './en';

/*
 * Português (Brasil). Window labels follow the app's own pt-BR strings
 * (frontend/src/i18n/locales/pt-BR), so the copies read exactly like the app.
 */

const copyKeys = (
  <KbdGroup>
    <Kbd>Ctrl</Kbd>
    <Kbd>Shift</Kbd>
    <Kbd>F5</Kbd>
  </KbdGroup>
);

export const pt: Messages = {
  meta: {
    title: 'Aion Companion: um companheiro de combate para AION 2',
    description:
      'Um companheiro gratuito e de código aberto para AION 2 no Windows: DPS ao vivo sobre o jogo, inspeção de grupo, alertas de chefes e farm de mascotes. Tudo fica no seu PC.',
  },
  skip: 'Pular para o conteúdo',
  header: {
    sections: 'Seções',
    nav: { features: 'Recursos', privacy: 'Privacidade', faq: 'Dúvidas' },
    download: 'Baixar',
    language: 'Idioma',
  },
  hero: {
    kicker: 'O app companheiro para AION 2',
    headline: 'Tudo o que o AION 2',
    headlineEm: 'não te mostra.',
    lede: 'DPS ao vivo sobre o jogo, relatórios de luta até cada habilidade, o equipamento e o Poder de Combate do seu grupo, alertas de 73 chefes de campo, todos os 207 mascotes e cada cubo oculto em Verteron e Altgard.',
    download: 'Baixar para Windows',
    seeFeatures: 'Ver os recursos',
    fine: 'Windows 10 e 11, x64 · Código aberto, MIT · Sem conta',
    fineShort: 'Windows 10 e 11 · Grátis · Sem conta',
  },
  features: {
    title: 'O que ele faz.',
    subtitle:
      'DPS ao vivo, registros de luta, inspeção de grupo, temporizadores de chefes, farm de mascotes e locais no mapa.',
    label: 'Recursos',
    list: [
      {
        id: 'live',
        name: 'DPS ao vivo',
        title: 'Cada golpe, no instante em que acerta.',
        points: [
          'DPS do encontro ou ativo, dano, parcela, Poder de Combate e mortes de todo o grupo.',
          'HP do chefe com previsão de abate e a contagem até a fúria.',
          'Clique em qualquer jogador para ver cada habilidade, alvo e golpe.',
          <>Cole os cinco primeiros no chat com {copyKeys}.</>,
        ],
        note: 'Este é um abate real de Atiel na Base de Pesquisa Deus, reproduzido segundo a segundo; só os nomes dos outros jogadores foram trocados. O dano vem direto dos números do próprio jogo.',
      },
      {
        id: 'reports',
        name: 'Registros e relatórios',
        title: 'Nove jeitos de ler uma luta.',
        points: [
          'Rotação e abertura: cada uso em ordem, com o HP do alvo e os buffs ativos.',
          'Buffs por habilidade, os últimos 10 segundos antes de cada morte, HP e DPS ao longo do tempo.',
          'Compare duas lutas, ou dois jogadores da mesma luta, habilidade por habilidade.',
          <>
            Treinos no boneco de <Fig>10</Fig> segundos a <Fig>5</Fig> minutos, cronometrados para
            você.
          </>,
        ],
        note: 'Toda luta é salva sozinha. Busque, rotule e agrupe por incursão.',
      },
      {
        id: 'group',
        name: 'Grupo',
        title: 'Conheça a sala antes do pull.',
        points: [
          'Classe, nível, GS, Poder de Combate e prontidão de todos na sala do grupo.',
          'Defina um GS ou Poder de Combate mínimo e veja quem fica abaixo.',
          'Abra o perfil completo: equipamento, Arcana, habilidades, tabuleiros Daevanion, atributos e visuais.',
          <>
            Guarde até <Fig>50</Fig> personagens favoritos a um clique.
          </>,
        ],
      },
      {
        id: 'alerts',
        name: 'Alertas e temporizadores',
        title: 'Esteja lá quando abrir.',
        points: [
          <>
            <Fig>73</Fig> chefes de campo em Verteron, Altgard, Eltnen, Morheim e Baixa Reshanta.
          </>,
          'Shugo Festival, Dimensional Invasion, Spacetime Rift e os chefes mundiais no relógio do seu servidor.',
          <>
            Até <Fig>8</Fig> lembretes por alerta, <Fig>6</Fig> sons, soneca e horário de silêncio.
          </>,
          'Pausa durante manutenções anunciadas e avisa quando terminam.',
        ],
        note: 'Estas contagens usam o relógio do seu computador.',
      },
      {
        id: 'pets',
        name: 'Mascotes',
        title: 'Todos os 207 mascotes. E onde estão.',
        points: [
          'Sua coleção nas cinco famílias, com os retratos do próprio jogo.',
          'O radar lista os monstros de alma ao seu redor, com distância e direção.',
          'Fixe uma meta de farm e acompanhe almas, níveis e mascotes novos.',
          <>
            <Fig>20.561</Fig> pontos de surgimento no terreno original de Verteron, Altgard e Baixa
            Reshanta.
          </>,
        ],
      },
      {
        id: 'explore',
        name: 'Explorar',
        title: 'Cada cubo oculto. Cada erva.',
        points: [
          <>
            <Fig>2.811</Fig> pontos de cubos ocultos em Verteron e Altgard.
          </>,
          <>
            <Fig>5.401</Fig> pontos de coleta de minério, ervas, gemas, madeira, comida e éter.
          </>,
          'A distância até cada ponto, numa janela que acompanha o seu mapa.',
        ],
        note: 'Este é Verteron, desenhado com os dados do próprio app. Os pontos são locais conhecidos, não um feed ao vivo.',
      },
      {
        id: 'windows',
        name: 'Janelas no jogo',
        title: 'Nove janelas. Zero alt-tab.',
        points: [
          'Trave qualquer janela e seus cliques passam direto para o jogo.',
          'Elas nunca roubam o foco e lembram onde você as deixou.',
          <>
            Rastreadores de recarga e buffs: até <Fig>32</Fig> barras por build.
          </>,
          'Cinco atalhos, todos configuráveis.',
        ],
      },
    ],
  },
  toolkit: {
    title: 'O resto do kit.',
    statsWindow: 'Números do Companion',
    stats: [
      'Habilidades reconhecidas',
      'Mascotes rastreados',
      'Chefes de campo',
      'Pontos de cubos ocultos',
      'Pontos de coleta',
      'Servidores Global',
    ],
    tools: [
      {
        title: 'Comparar',
        body: 'Sua luta ao vivo contra uma salva, ou dois jogadores frente a frente.',
      },
      {
        title: 'Replay',
        body: 'Percorra uma gravação: o dano em qualquer segundo e onde cada um estava.',
      },
      {
        title: 'Copiar resumo',
        body: 'Uma linha ou uma por jogador, pronto para colar no chat do grupo.',
      },
      {
        title: 'Ocultar nomes',
        body: 'Classe e posição no lugar dos nomes quando você faz live ou compartilha um print.',
      },
      {
        title: 'Backups',
        body: 'Ajustes, progresso de mascotes e registros num arquivo, com prévia antes de restaurar.',
      },
      {
        title: 'Atualizações',
        body: 'Baixadas e verificadas em segundo plano; só troca quando você mandar.',
      },
      {
        title: 'Relatórios de bug',
        body: 'Um arquivo que você lê antes de enviar. Nada sai sozinho.',
      },
      {
        title: 'Português e inglês',
        body: 'O app inteiro, a bandeja e os resumos copiados, nos dois idiomas.',
      },
    ],
  },
  privacy: {
    kicker: 'Privacidade',
    line1: 'Suas lutas.',
    line2: 'Seu PC.',
    lede: 'O Aion Companion não tem servidores próprios. Tudo o que ele registra fica com você.',
    facts: [
      {
        title: 'Fica no seu PC',
        body: 'Lutas, registros, ajustes, alertas e progresso de mascotes nunca saem do seu computador.',
      },
      {
        title: 'Sem conta',
        body: 'Nada para cadastrar. Sem telemetria, sem envio da sua jogatina.',
      },
      {
        title: 'Escuta, nunca mexe',
        body: 'Ele lê o tráfego do jogo. Nunca envia nem altera um pacote e nunca edita arquivos do jogo.',
      },
      {
        title: 'Aberto e verificável',
        body: 'Código no GitHub sob licença MIT, e um checksum SHA‑256 para cada download.',
      },
    ],
  },
  faq: {
    kicker: 'Dúvidas',
    title: 'Respostas diretas.',
    ask: 'Ficou alguma dúvida? Abra uma issue e pergunte.',
    askButton: 'Perguntar no GitHub',
    items: [
      {
        q: 'É grátis?',
        a: (
          <>
            Sim. Sem conta, sem assinatura, sem anúncios. O código está no{' '}
            <a href={REPO_URL}>GitHub</a> sob a licença MIT.
          </>
        ),
      },
      {
        q: 'Posso ser banido por usar?',
        a: 'O app só lê o tráfego de rede. Nunca envia nem altera pacotes e nunca mexe nos arquivos do jogo. Isso não é uma promessa sobre as regras ou o anticheat da NCSOFT, e ninguém fora da NCSOFT pode fazer essa promessa. Use sabendo disso.',
      },
      {
        q: 'O medidor é preciso?',
        a: 'O dano vem direto dos números do próprio jogo e nunca é estimado. O que aconteceu antes de a captura começar fica desconhecido até o jogo enviar de novo. PvP e os clientes de Taiwan e Coreia ainda não foram verificados.',
      },
      {
        q: 'Por que ele precisa do Npcap?',
        a: 'O Npcap permite ler o tráfego do jogo: o DPS ao vivo, a sala do grupo, os rastreadores e o radar de mascotes precisam dele. Registros, relatórios, alertas, mapas e o planejamento de mascotes funcionam sem ele. Instale só pelo site oficial.',
      },
      {
        q: 'Por que o Windows avisa sobre ele?',
        a: (
          <>
            As versões ainda não têm assinatura de código. Baixe só das{' '}
            <a href={DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
              versões do projeto
            </a>{' '}
            e compare o arquivo com o SHA‑256 publicado. Nunca desative a proteção do Windows para
            rodá-lo.
          </>
        ),
      },
      {
        q: 'Quais regiões ele suporta?',
        a: 'Os servidores Global são o alvo testado, com todos os 106 servidores Global no relógio de alertas. Taiwan e Coreia podem ser escolhidos, mas não foram verificados. Os perfis de personagem são só do Global.',
      },
      {
        q: 'Está no meu idioma?',
        a: 'O app e este site estão em português (Brasil) e inglês. Troque quando quiser.',
      },
      {
        q: 'É feito pela NCSOFT?',
        a: 'Não. É um projeto independente de fãs, sem vínculo nem aval da NCSOFT.',
      },
    ],
  },
  final: {
    title: 'Veja a',
    titleEm: 'luta inteira.',
    lede: 'Grátis para Windows 10 e 11. Instale antes da próxima incursão.',
    download: 'Baixar para Windows',
  },
  footer: {
    disclaimer:
      'Um projeto de fãs não oficial, sem vínculo nem aval da NCSOFT. As artes de classes, mascotes e mapas e os dados de AION 2 pertencem à NCSOFT / NC Corporation e não estão cobertos pela licença MIT. As demonstrações desta página usam os dados fictícios de demonstração do app.',
    links: 'Links do projeto',
    releases: 'Versões',
    source: 'Código',
    issues: 'Issues',
    licence: 'Licença MIT',
  },
  app: {
    companion: 'Companion',
    damageDealt: 'Dano',
    lastHit: 'Último golpe',
    boss: 'Chefe',
    kill: 'Abate',
    rage: 'Fúria',
    defeated: 'Derrotado',
    done: 'fim',
    cp: 'PC',
    me: 'EU',
    liveSince: (time) => `Ao vivo · desde ${time}`,
    savedToLogs: 'Salvo nos registros',
    timers: 'Temporizadores',
    yourClock: 'Seu relógio',
    alive: 'Vivo',
    unknown: 'Desconhecido',
    dailyReset: 'Reset diário',
    weeklyReset: 'Reset semanal',
    radarLive: 'Ao vivo',
    notNearby: 'Não está perto',
    toLevel: (souls, level) => `${souls} até Nv ${level}`,
    toObtain: (souls) => `${souls} para obter`,
    pointsOnMap: (n) => `${n} pontos neste mapa`,
    mapKey: { goal: 'Meta', pinned: 'Fixados', spawns: 'Spawns', live: 'Ao vivo' },
    group: 'Grupo',
    dps: 'DPS',
    preparing: 'Preparando',
    ready: (n) => `${n} ${n === 1 ? 'pronto' : 'prontos'}`,
    dungeon: 'Base de Pesquisa Deus (Transcendência)',
    readiness: 'Prontidão observada há 6 s · a mais antiga há 10 s',
    gsLevel: (gs, level) => `GS ${gs} · Nv. ${level}`,
    inspected: 'Perfis inspecionados',
    findCompare: 'Buscar e comparar',
    live: 'Ao vivo',
    average: 'Média',
    detailsTitle: 'Detalhes do dano',
    pause: 'Pausar',
    encounter: 'Confronto',
    encounterMeta: (time) => `${time} · Em andamento · Todos os alvos · run-atiel`,
    tabs: [
      'Dano',
      'Cura',
      'Recebido',
      'Mortes',
      'Destaques',
      'Habilidades',
      'Rotação',
      'Buffs',
      'Linha do tempo',
    ],
    rotationTab: 'Rotação',
    opener: 'Abertura',
    first30: 'primeiros 30 s',
    targetHp: 'HP do alvo',
    buffsSelf: 'Buffs próprios',
    partyBuffs: 'Buffs do grupo',
    castAt: (at, hp) => `em ${at} s · HP do alvo ${hp}`,
    hits: 'Golpes',
    crits: 'Críticos',
    event: 'Evento',
    startingNow: 'Começando agora',
    minBefore: (n) => `${n} min antes`,
    borderless: 'AION 2 · sem bordas',
    gameInView: 'Seu jogo continua à vista',
    layers: 'Camadas do mapa',
    mapLabel:
      'Mapa de Verteron com cada cubo oculto e ponto de coleta desenhados como pontos de luz.',
    north: 'N',
    layer: {
      cube: 'Cubos ocultos',
      ore: 'Minério',
      herb: 'Ervas',
      gemstone: 'Gemas',
      aether: 'Éter',
      food: 'Comida',
      wood: 'Madeira',
    },
  },
};
