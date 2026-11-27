import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import {
  chaveTelefone,
  classificarTipoMensagem,
  ehConversaIndividual,
  IndiceTelefonesClientes,
  previaMensagem,
  telefoneDoIdConversa,
  validarTextoEnvio,
} from '../dist/domain/whatsappChat.js';
import { ChatWhatsApp } from '../dist/application/use-cases/ChatWhatsApp.js';
import { WhatsAppChatRepository } from '../dist/infrastructure/postgres/WhatsAppChatRepository.js';
import { WhatsAppController } from '../dist/adapters/controllers/WhatsAppController.js';
import { iniciarPostgresTeste } from './helpers/postgresTeste.mjs';

// ---------------------------------------------------------------- regras puras

test('telefones equivalentes com e sem 55, com e sem o nono dígito, geram a mesma chave', () => {
  const esperada = chaveTelefone('5586981020204');
  for (const variante of ['(86) 9 8102-0204', '86981020204', '558681020204', '8681020204', '086981020204']) {
    assert.equal(chaveTelefone(variante), esperada, variante);
  }
  assert.notEqual(chaveTelefone('5511981020204'), esperada, 'DDD diferente não casa');
  assert.equal(chaveTelefone(''), null);
  assert.equal(chaveTelefone('123'), null);
  assert.equal(chaveTelefone('+351 912 345 678'), '+351912345678');
});

test('só conversas individuais entram; grupos, status e canais ficam de fora', () => {
  assert.equal(ehConversaIndividual('558681020204@c.us'), true);
  assert.equal(ehConversaIndividual('123456789@lid'), true);
  assert.equal(ehConversaIndividual('120363000000@g.us'), false);
  assert.equal(ehConversaIndividual('status@broadcast'), false);
  assert.equal(ehConversaIndividual('120363000000@newsletter'), false);
  assert.equal(ehConversaIndividual(undefined), false);
  assert.equal(telefoneDoIdConversa('558681020204@c.us'), '558681020204');
  assert.equal(telefoneDoIdConversa('123@lid'), null);
});

test('tipos de sistema são ignorados e mídias ganham rótulo na prévia', () => {
  assert.equal(classificarTipoMensagem('chat'), 'texto');
  assert.equal(classificarTipoMensagem('ptt'), 'audio');
  assert.equal(classificarTipoMensagem('e2e_notification'), null);
  assert.equal(classificarTipoMensagem('reaction'), null);
  assert.equal(classificarTipoMensagem('poll_creation'), 'outro');
  assert.equal(previaMensagem('imagem', ''), '📷 Imagem');
  assert.equal(previaMensagem('imagem', 'nota fiscal'), '📷 Imagem: nota fiscal');
  assert.equal(previaMensagem('texto', '  oi\n\ntudo bem? '), 'oi tudo bem?');
});

test('índice liga o telefone ao contato do cliente, priorizando contatos com nome', () => {
  const indice = new IndiceTelefonesClientes([
    { id: 'e1', nomeEmpresa: 'Gama', telefone: '86 98102-0204', contatos: [{ nome: 'João', telefone: '86981020204', telefones: ['86981020204', '86999990000'] }] },
    { id: 'e2', nomeEmpresa: 'Delta', contatos: [{ nome: 'Ana', telefone: '1133334444' }] },
  ]);
  assert.deepEqual(indice.vinculos('558681020204'), [
    { empresaId: 'e1', nomeEmpresa: 'Gama', contatoNome: 'João' },
    { empresaId: 'e1', nomeEmpresa: 'Gama', contatoNome: null },
  ]);
  assert.equal(indice.vinculos('5586999990000')[0].contatoNome, 'João');
  assert.equal(indice.vinculos('551133334444')[0].nomeEmpresa, 'Delta');
  assert.deepEqual(indice.vinculos('5586900000000'), []);
  assert.deepEqual(indice.vinculos(null), []);
});

test('texto vazio ou longo demais é recusado antes de chegar ao WhatsApp', () => {
  assert.throws(() => validarTextoEnvio('   '), /Digite a mensagem/);
  assert.throws(() => validarTextoEnvio(undefined), /Digite a mensagem/);
  assert.throws(() => validarTextoEnvio('x'.repeat(4097)), /4096/);
  assert.equal(validarTextoEnvio('Olá!\n'), 'Olá!');
});

test('com o bloqueio ligado, a rota de envio automático recusa sem tocar no WhatsApp', async () => {
  let chamado = false;
  const controller = new WhatsAppController({ execute: async () => { chamado = true; return true; } }, {}, { execute: () => ({ status: 'connected' }) }, true);
  const res = { status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await controller.send({ body: { to: '86981020204', message: 'oi' } }, res);
  assert.equal(res.code, 403);
  assert.equal(chamado, false);
});

// ---------------------------------------------------------------- caso de uso (repositório real)

let pg;
let repositorio;
before(async () => {
  pg = await iniciarPostgresTeste();
  repositorio = new WhatsAppChatRepository(pg.pool);
});
after(async () => { await pg?.encerrar(); });
beforeEach(async () => { await pg.pool.query('truncate whatsapp_mensagens, whatsapp_conversas'); });

const CLIENTE = '558681020204@c.us';
const PESSOAL = '558699998888@c.us';
let sequencia = 0;
function mensagem(extras = {}) {
  sequencia += 1;
  return {
    id: `msg-${sequencia}`, conversaId: CLIENTE, telefone: telefoneDoIdConversa(extras.conversaId ?? CLIENTE),
    nomeContato: 'João', deMim: false, tipo: 'texto', texto: `mensagem ${sequencia}`, enviadaEm: 1_700_000_000_000 + sequencia * 1000,
    ...extras,
  };
}

function whatsappFalso() {
  const falso = {
    conectado: true,
    enviados: [],
    recentes: [],
    historico: new Map(),
    onMensagem(cb) { falso.receber = cb; },
    onConectado(cb) { falso.aoConectar = cb; },
    estaConectado: () => falso.conectado,
    async enviarTexto(conversaId, texto) {
      falso.enviados.push({ conversaId, texto });
      return mensagem({ conversaId, deMim: true, texto, nomeContato: null });
    },
    async listarConversasRecentes() { return falso.recentes; },
    async buscarMensagens(id) { return falso.historico.get(id) ?? []; },
  };
  return falso;
}

const indiceFixo = { obter: async () => new IndiceTelefonesClientes([{ id: 'e1', nomeEmpresa: 'Gama', contatos: [{ nome: 'João', telefone: '86981020204' }] }]) };

function criarChat(somenteClientes = false) {
  const whatsapp = whatsappFalso();
  const chat = new ChatWhatsApp(repositorio, whatsapp, indiceFixo, { somenteClientes });
  const eventos = [];
  chat.aoMudar((e) => eventos.push(e));
  return { chat, whatsapp, eventos };
}

test('mensagem recebida é gravada uma vez, conta como não lida e avisa a tela com o cliente vinculado', async () => {
  const { chat, eventos } = criarChat();
  const recebida = mensagem();
  assert.equal(await chat.registrar(recebida, { contarNaoLida: true }), 'nova');
  assert.equal(await chat.registrar(recebida, { contarNaoLida: true }), 'existente');
  assert.equal(eventos.length, 1, 'reenvio do mesmo id não avisa de novo');
  assert.equal(eventos[0].conversa.naoLidas, 1);
  assert.equal(eventos[0].conversa.vinculos[0].nomeEmpresa, 'Gama');
  const [conversa] = await chat.listarConversas();
  assert.equal(conversa.ultimaMensagemPrevia, recebida.texto);
  assert.equal((await chat.listarMensagens(CLIENTE)).length, 1);
});

test('modo "só clientes" não grava conversas particulares nem as expõe', async () => {
  const { chat, eventos } = criarChat(true);
  assert.equal(await chat.registrar(mensagem({ conversaId: PESSOAL }), { contarNaoLida: true }), 'ignorada');
  assert.equal(await chat.registrar(mensagem(), { contarNaoLida: true }), 'nova');
  const { rows } = await pg.pool.query('select id from whatsapp_conversas');
  assert.deepEqual(rows.map((r) => r.id), [CLIENTE]);
  assert.equal(eventos.length, 1);
  await assert.rejects(chat.listarMensagens(PESSOAL), /não encontrada/);
});

test('envio pelo Radar registra quem enviou, zera as não lidas e não duplica com o evento do WhatsApp', async () => {
  const { chat, whatsapp } = criarChat();
  await chat.registrar(mensagem(), { contarNaoLida: true });
  const enviada = await chat.enviar(CLIENTE, 'Confirmado para amanhã às 9h', { uid: 'u1', nome: 'Pedro' });
  assert.deepEqual(whatsapp.enviados, [{ conversaId: CLIENTE, texto: 'Confirmado para amanhã às 9h' }]);
  assert.equal(enviada.enviadoPorNome, 'Pedro');
  // O mesmo envio chega depois pelo evento message_create, sem autor: não sobrescreve nem duplica.
  await chat.registrar({ ...enviada, telefone: '558681020204', nomeContato: null }, { contarNaoLida: true });
  const mensagens = await chat.listarMensagens(CLIENTE);
  assert.equal(mensagens.length, 2);
  assert.equal(mensagens[1].enviadoPorUid, 'u1');
  assert.equal((await chat.listarConversas())[0].naoLidas, 0);
});

test('o autor é completado quando o evento do WhatsApp chega antes da resposta do envio', async () => {
  const saida = mensagem({ deMim: true, nomeContato: null });
  await repositorio.registrarMensagem(saida, { contarNaoLida: true });
  const resultado = await repositorio.registrarMensagem(saida, { contarNaoLida: false, autor: { uid: 'u2', nome: 'Ana' } });
  assert.equal(resultado.nova, false);
  assert.equal(resultado.mensagem.enviadoPorNome, 'Ana');
});

test('envio recusa texto vazio, conversa inexistente e WhatsApp desconectado', async () => {
  const { chat, whatsapp } = criarChat();
  await chat.registrar(mensagem(), { contarNaoLida: true });
  await assert.rejects(chat.enviar(CLIENTE, ' ', { uid: 'u1', nome: null }), (e) => e.status === 400);
  await assert.rejects(chat.enviar('5500000000000@c.us', 'oi', { uid: 'u1', nome: null }), (e) => e.status === 404);
  whatsapp.conectado = false;
  await assert.rejects(chat.enviar(CLIENTE, 'oi', { uid: 'u1', nome: null }), (e) => e.status === 503);
  assert.equal(whatsapp.enviados.length, 0);
});

test('marcar como lida zera o contador e avisa as telas', async () => {
  const { chat, eventos } = criarChat();
  await chat.registrar(mensagem(), { contarNaoLida: true });
  await chat.registrar(mensagem(), { contarNaoLida: true });
  const conversa = await chat.marcarComoLida(CLIENTE);
  assert.equal(conversa.naoLidas, 0);
  assert.equal(eventos.at(-1).tipo, 'conversa');
});

test('paginação volta no tempo sem perder mensagens do mesmo segundo', async () => {
  const mesmoSegundo = 1_800_000_000_000;
  for (let i = 0; i < 60; i++) {
    await repositorio.registrarMensagem(mensagem({ id: `p-${String(i).padStart(2, '0')}`, enviadaEm: mesmoSegundo }), { contarNaoLida: false });
  }
  const primeira = await repositorio.listarMensagens(CLIENTE, 50);
  assert.equal(primeira.length, 50);
  const segunda = await repositorio.listarMensagens(CLIENTE, 50, { enviadaEm: primeira[0].enviadaEm, id: primeira[0].id });
  assert.equal(segunda.length, 10);
  const ids = new Set([...primeira, ...segunda].map((m) => m.id));
  assert.equal(ids.size, 60);
});

test('recuperação após queda grava o que faltou sem duplicar e só então usa as não lidas do WhatsApp', async () => {
  const { chat, whatsapp } = criarChat();
  const antiga = mensagem();
  await chat.registrar(antiga, { contarNaoLida: true });
  await chat.marcarComoLida(CLIENTE);

  // Nada novo: a conversa lida no Radar continua lida, mesmo que o celular indique não lidas.
  whatsapp.recentes = [{ conversaId: CLIENTE, naoLidas: 3 }, { conversaId: '120363@g.us', naoLidas: 9 }];
  whatsapp.historico.set(CLIENTE, [antiga]);
  assert.equal(await chat.recuperarRecentes(), 0);
  assert.equal((await chat.listarConversas())[0].naoLidas, 0);

  // Chegou mensagem enquanto o processo estava fora.
  const perdida = mensagem();
  whatsapp.historico.set(CLIENTE, [antiga, perdida]);
  whatsapp.recentes = [{ conversaId: CLIENTE, naoLidas: 1 }];
  assert.equal(await chat.recuperarRecentes(), 1);
  const [conversa] = await chat.listarConversas();
  assert.equal(conversa.naoLidas, 1);
  assert.equal(conversa.ultimaMensagemPrevia, perdida.texto);
  assert.equal((await chat.listarMensagens(CLIENTE)).length, 2);
});

test('mensagem antiga trazida pela recuperação não troca a prévia da mais recente', async () => {
  const recente = mensagem({ enviadaEm: 2_000_000_000_000 });
  await repositorio.registrarMensagem(recente, { contarNaoLida: false });
  await repositorio.registrarMensagem(mensagem({ enviadaEm: 1_000_000_000_000 }), { contarNaoLida: false });
  const conversa = await repositorio.obterConversa(CLIENTE);
  assert.equal(conversa.ultimaMensagemPrevia, recente.texto);
  assert.equal(conversa.ultimaMensagemEm, recente.enviadaEm);
});
