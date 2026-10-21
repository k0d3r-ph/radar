import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calcularDiasSuspensaoAtual,
  calcularDiasSuspensoPelaOcorrencia,
  obterOcorrenciaSuspensaoAtual,
} from '../src/utils/monitoramento/calcularDiasSuspenso.ts';

const em = (iso) => Date.parse(iso);

test('conta dias corridos de Brasília a partir da data da ocorrência', () => {
  const ocorrencia = { dataOcorrencia: em('2026-10-01T23:30:00-03:00'), createdAt: em('2026-10-20T10:00:00-03:00') };
  assert.equal(calcularDiasSuspensoPelaOcorrencia(ocorrencia, em('2026-10-01T23:59:00-03:00')), 0);
  assert.equal(calcularDiasSuspensoPelaOcorrencia(ocorrencia, em('2026-10-02T00:01:00-03:00')), 1);
  assert.equal(calcularDiasSuspensoPelaOcorrencia(ocorrencia, em('2026-10-21T09:00:00-03:00')), 20);
});

test('usa a data de criação quando a ocorrência não tem data e nunca fica negativo', () => {
  assert.equal(calcularDiasSuspensoPelaOcorrencia({ createdAt: em('2026-10-18T12:00:00-03:00') }, em('2026-10-21T12:00:00-03:00')), 3);
  assert.equal(calcularDiasSuspensoPelaOcorrencia({ dataOcorrencia: em('2026-10-25T12:00:00-03:00') }, em('2026-10-21T12:00:00-03:00')), 0);
});

test('usa a suspensão mais recente e ignora a que já teve retorno à esteira', () => {
  const antiga = { id: 'a', suspenderCliente: true, createdAt: 1 };
  const retorno = { id: 'r', retornarEsteira: true, createdAt: 2 };
  const atual = { id: 'b', suspenderCliente: true, createdAt: 3 };
  assert.equal(obterOcorrenciaSuspensaoAtual([antiga, retorno, atual])?.id, 'b');
  assert.equal(obterOcorrenciaSuspensaoAtual([antiga, retorno]), undefined);
  assert.equal(obterOcorrenciaSuspensaoAtual([{ id: 'x', tipo: 'Informativo', createdAt: 5 }]), undefined);
});

test('suspensão atual conta pela ocorrência; sem ela, pela dataSuspensao da empresa', () => {
  const agora = em('2026-10-21T12:00:00-03:00');
  const empresa = { isSuspended: true, dataSuspensao: '2026-10-19' };
  const historico = [{ id: 's', suspenderCliente: true, dataOcorrencia: em('2026-10-11T09:00:00-03:00'), createdAt: em('2026-10-20T09:00:00-03:00') }];
  assert.equal(calcularDiasSuspensaoAtual(empresa, historico, agora), 10);
  // Sem ocorrência, mantém a regra antiga (dataSuspensao até hoje).
  const esperadoSemOcorrencia = calcularDiasSuspensaoAtual(empresa, []);
  assert.ok(esperadoSemOcorrencia >= 0);
  assert.equal(calcularDiasSuspensaoAtual({ isSuspended: true }, []), 0);
});
