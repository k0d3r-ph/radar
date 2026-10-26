import type { PerguntaConhecimento, Secao } from './validacaoConhecimento.js';

const iniciais = [
  'Onde consultar a lista de equipamentos integrados ao SSX e suas informações técnicas?',
  'Como vincular um rastreador a um veículo no SSX?',
  'Como desvincular um rastreador de um veículo no SSX?',
  'O que deve ser verificado quando um equipamento deixa de se comunicar com o SSX?',
  'Crie um usuário para a central de rastreamento que tenha acesso somente à visualização do rastreamento do veículo ______.',
  'Como redefinir a senha de um usuário no SSX?',
  'Onde consultar os valores dos acessos e dos produtos cadastrados no sistema?',
  'Como conferir os valores dos acessos e produtos no sistema?',
  'Crie um perfil de acesso para um cliente que não permita visualizar o relatório Geral.',
  'Crie uma regra de monitoramento para identificar situações em que o veículo ultrapasse a velocidade de 100 km/h.',
  'Crie uma área geográfica no entorno do Aeroporto Internacional do Galeão, no Rio de Janeiro, e configure uma regra para identificar a saída de veículos dessa área.',
  'Como localizar e visualizar no mapa um veículo de um cliente?',
  'Onde consultar os detalhes e as informações de uma posição registrada no SSX?',
  'Qual é o endereço da localização atual do veículo ______?',
  'Como verificar se o veículo ______ está bloqueado ou desbloqueado?',
  'Como enviar um comando de bloqueio ou outro comando ao rastreador diretamente pela plataforma SSX?',
  'Onde consultar o histórico dos comandos enviados pela plataforma SSX?',
  'Como consultar e exportar o histórico de uma unidade rastreada?',
  'Como compartilhar ou exportar a localização de um veículo para visualização no Google Maps ou no Waze?',
  'Qual relatório permite consultar os trajetos realizados e a quilometragem percorrida por uma unidade rastreada?',
  'Como verificar se o veículo ______ passou pela Rua ______ entre os dias //____ e //____? Qual relatório permite consultar essa informação?',
];
const avancadas: Partial<Record<Secao, string[]>> = {
  Videotelemetria: ['Como visualizar o vídeo ao vivo do veículo ______?', 'Como consultar uma gravação de vídeo do veículo ______ realizada ontem?'],
  Abastecimento: ['Como registrar um abastecimento pela versão web do SSX?', 'Como consultar o relatório de abastecimentos?'],
  'Manutenção básica': ['Como registrar uma manutenção para o veículo ______?'],
  'Manutenção avançada': ['Como vincular um plano de manutenção ao veículo ______?'],
  Performance: ['Onde criar uma fórmula de avaliação no módulo Performance?', 'Qual foi o maior percentual de infração de condução segura registrado na semana atual?'],
  'Jornada de Trabalho': ['Como configurar uma jornada de trabalho reduzida?', 'Como ajustar uma jornada de trabalho já registrada?'],
  Onboard: ['Como criar um acesso ao aplicativo Onboard?', 'Como vincular o aplicativo Onboard a um motorista e remover sua ativação?'],
  Logistics: ['Como cadastrar o endereço de um cliente no módulo Logistics?', 'Como criar uma base operacional e configurar os pontos de início e fim de uma viagem?'],
  Fretamento: ['No módulo Fretamento, é possível identificar o motorista e os passageiros por meio do iButton e do Onboard?', 'Como configurar o RFID para que o sistema identifique uma pessoa como passageiro?'],
  'Gestão de Multas': ['Quantas multas foram recebidas nos últimos sete dias?', 'Onde localizar e gerar o boleto da multa ______?'],
};
export const PERGUNTAS_INICIAIS: PerguntaConhecimento[] = [
  ...iniciais.map((texto, i) => ({ id: `inicial-${i + 1}`, secao: 'Temas iniciais' as const, texto, preferida: [2, 3, 4, 6, 12, 14, 16, 18, 20, 21].includes(i + 1) })),
  ...Object.entries(avancadas).flatMap(([secao, perguntas]) => perguntas.map((texto, i) => ({ id: `modulo-${Object.keys(avancadas).indexOf(secao)}-${i + 1}`, secao: secao as Secao, texto, preferida: false }))),
];
