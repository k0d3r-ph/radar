import { describe, it, expect } from 'vitest';
import { isTimeOutOfOffice } from './workingHours';

describe('isTimeOutOfOffice', () => {
  const config = {
    startTime: '08:00',
    endTime: '18:00',
    workingDays: [1, 2, 3, 4, 5] // Mon-Fri
  };

  it('deve retornar true para finais de semana (Domingo)', () => {
    // 2026-07-12 é um Domingo
    const sundayDate = new Date('2026-07-12T12:00:00');
    expect(isTimeOutOfOffice(sundayDate, config)).toBe(true);
  });

  it('deve retornar true para finais de semana (Sábado)', () => {
    // 2026-07-11 é um Sábado
    const saturdayDate = new Date('2026-07-11T12:00:00');
    expect(isTimeOutOfOffice(saturdayDate, config)).toBe(true);
  });

  it('deve retornar false para dia útil dentro do expediente (Segunda, 10:00)', () => {
    // 2026-07-13 é uma Segunda-feira
    const mondayWorking = new Date('2026-07-13T10:00:00');
    expect(isTimeOutOfOffice(mondayWorking, config)).toBe(false);
  });

  it('deve retornar true para dia útil antes do expediente (Segunda, 07:30)', () => {
    const mondayEarly = new Date('2026-07-13T07:30:00');
    expect(isTimeOutOfOffice(mondayEarly, config)).toBe(true);
  });

  it('deve retornar true para dia útil após o expediente (Segunda, 18:30)', () => {
    const mondayLate = new Date('2026-07-13T18:30:00');
    expect(isTimeOutOfOffice(mondayLate, config)).toBe(true);
  });

  it('deve usar dias úteis padrão (Mon-Fri) se workingDays for omitido', () => {
    const sundayDate = new Date('2026-07-12T12:00:00');
    const mondayDate = new Date('2026-07-13T12:00:00');
    
    const limitedConfig = { startTime: '08:00', endTime: '18:00' };
    
    expect(isTimeOutOfOffice(sundayDate, limitedConfig)).toBe(true);
    expect(isTimeOutOfOffice(mondayDate, limitedConfig)).toBe(false);
  });
});
