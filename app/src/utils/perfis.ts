/**
 * Perfis que atuam como treinador na esteira. O perfil Master acumula as
 * atribuições de treinador (ex.: recebe clientes na distribuição), por isso
 * também entra no ranking de carga e tem fator de capacidade configurável.
 */
export const ROLES_TREINADOR = ["treinador", "master"] as const;

export const atuaComoTreinador = (role?: string) =>
  ROLES_TREINADOR.includes(role as (typeof ROLES_TREINADOR)[number]);
