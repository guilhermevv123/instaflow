// InstaFlow · leitura em páginas. O PostgREST do Supabase devolve no máximo
// 1000 linhas por pedido e corta o resto sem avisar (sem erro): em 30 e 90 dias
// os retratos diários dos posts passam de 15 mil linhas e o período vinha só
// com os dias mais antigos. `pagina(de, ate)` monta a consulta com
// .range(de, ate) e ordem estável; pede `lote` páginas por vez.
export async function todas(pagina, { tam = 1000, max = Infinity, lote = 4 } = {}) {
  const data = [];
  for (let de = 0; de < max; de += tam * lote) {
    const faixas = [];
    for (let k = 0; k < lote && de + k * tam < max; k++) {
      const a = de + k * tam;
      faixas.push([a, Math.min(a + tam, max) - 1]);
    }
    const res = await Promise.all(faixas.map(([a, b]) => pagina(a, b)));
    for (let k = 0; k < res.length; k++) {
      const { data: linhas, error } = res[k];
      if (error) return { data: null, error };
      data.push(...(linhas || []));
      if (!linhas || linhas.length < faixas[k][1] - faixas[k][0] + 1) return { data, error: null };
    }
  }
  return { data, error: null };
}
