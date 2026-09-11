// InstaFlow · variações de legenda SEM IA (grátis, roda no navegador).
//
// Faz N versões da mesma legenda para publicar o mesmo post em várias contas
// sem texto repetido, só com mudanças que não alteram o sentido:
//   - expressões comuns trocadas por equivalentes ("continue firme" → "siga firme");
//   - vocativo no começo ou no fim ("Continue firme, Big!" → "Big, continue firme!");
//   - quebra de linhas (frases na mesma linha ou uma por linha);
//   - emojis trocados por equivalentes (nunca a cor de um coração nem uma bandeira);
//   - hashtags do fim em outra ordem.
// Números (ex.: 44144), @menções, links e o texto das #hashtags nunca mudam.
// Quando a legenda não tem nada disso para variar, o último recurso é um emoji
// a mais — essas versões voltam contadas em `fracas` para a tela avisar.
// Com a IA ligada (Config), quem reescreve é a IA; isto aqui completa o que faltar.

const PROT_SRC = String.raw`(?:https?:\/\/|www\.)[^\s]+|@[\p{L}\p{N}_.]*[\p{L}\p{N}_]|#[\p{L}\p{N}_]+|\d+(?:[.,:\/]\d+)*`;
const PH_OPEN = "\uE000", PH_CLOSE = "\uE001";
const PH_SRC = "\uE000(\\d+)\uE001";
const EMO = "(?:[\\u{1F1E6}-\\u{1F1FF}]{2}|\\p{Extended_Pictographic}(?:\\uFE0F|\\u20E3|[\\u{1F3FB}-\\u{1F3FF}]|\\u200D\\p{Extended_Pictographic}\\uFE0F?)*)";
const emoRe = () => new RegExp(EMO, "gu");

// ----------------------------------------------------------------- expressões
// Grupos de expressões que se trocam sem mexer na concordância. Só entram
// frases feitas (várias palavras) ou palavras que não mudam de sentido.
// `inicio: true` = verbo que também existe fora do imperativo ("quem acompanha",
// "para que você veja"): só troca no começo da frase, depois de vírgula ou de emoji.
const G = (formas, inicio = false) => ({ formas: [...formas].sort((a, b) => b.length - a.length), inicio });
const GRUPOS = [
  G(["continue firme", "siga firme", "segue firme"], true),
  G(["vamos juntos", "bora juntos", "vamos junto"]),
  G(["estamos juntos", "seguimos juntos", "tamo junto"]),
  G(["muito obrigado", "obrigado de coração", "muito obrigado mesmo"]),
  G(["muito obrigada", "obrigada de coração", "muito obrigada mesmo"]),
  G(["obrigado a todos", "obrigado a cada um de vocês", "valeu a todos"]),
  G(["obrigada a todos", "obrigada a cada um de vocês"]),
  G(["confira", "veja", "olha só"], true),
  G(["com certeza", "sem dúvida", "certamente"]),
  G(["a luta continua", "a caminhada continua", "seguimos na luta"]),
  G(["conto com você", "conto com o seu apoio", "conto contigo"]),
  G(["conto com vocês", "conto com o apoio de vocês"]),
  G(["vem com a gente", "vem junto com a gente", "venha com a gente"], true),
  G(["juntos somos mais fortes", "unidos somos mais fortes", "juntos, somos mais fortes"]),
  G(["quem acompanha sabe", "quem acompanha de perto sabe", "quem está acompanhando sabe"]),
  G(["tem trabalho sendo feito", "o trabalho está sendo feito"]),
  G(["mais uma vez", "novamente", "outra vez"]),
  G(["cada vez mais", "sempre mais"]),
  G(["grande dia", "dia especial", "dia importante"]),
  G(["foi incrível", "foi demais", "foi sensacional"]),
  G(["não deixe de", "não esqueça de"], true),
  G(["saiba mais", "veja mais", "entenda melhor"], true),
  G(["link na bio", "link na biografia", "o link está na bio"]),
  G(["fique ligado", "fica ligado", "fiquem ligados"], true),
  G(["até breve", "até logo", "nos vemos em breve"]),
  G(["forte abraço", "um abraço", "grande abraço"]),
  G(["em breve", "muito em breve", "logo logo"]),
  G(["é hora de", "chegou a hora de"]),
  G(["vamos pra cima", "bora pra cima", "vamos para cima"]),
  G(["muito feliz", "muito contente", "super feliz"]),
  G(["que alegria", "quanta alegria", "que felicidade"]),
  G(["boa noite, pessoal", "boa noite, galera", "boa noite a todos"]),
  G(["bom dia, pessoal", "bom dia, galera", "bom dia a todos"]),
  G(["boa tarde, pessoal", "boa tarde, galera", "boa tarde a todos"]),
  G(["trabalho sério", "trabalho de verdade", "trabalho com seriedade"]),
  G(["acompanhe", "siga acompanhando"], true),
  G(["participe", "venha participar"], true),
  G(["estamos chegando", "estamos a caminho"]),
];

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const INICIO_DE_FRASE = String.raw`(?<=^|[.!?…:]\s+|\n[ \t]*|,\s+|${EMO}\s*)`;
const formaRe = (f, inicio) => new RegExp(`${inicio ? INICIO_DE_FRASE : String.raw`(?<![\p{L}\p{N}])`}${escRe(f).replace(/\s+/g, String.raw`\s+`)}(?![\p{L}\p{N}])`, "giu");
const GRUPOS_RE = GRUPOS.map((g) => g.formas.map((f) => formaRe(f, g.inicio)));

// ----------------------------------------------------------------- vocativo
const MAI = "A-ZÁÀÂÃÉÊÍÓÔÕÚÇ";
const VOC_COMUNS = ["minha gente", "meu povo", "pessoal", "galera", "gente", "amigos", "amigas", "povo", "família", "turma"];
const ci = (w) => w.replace(/^(\p{L})/u, (c) => `[${c.toUpperCase()}${c.toLowerCase()}]`);
const NOME = String.raw`[${MAI}][\p{L}'’]+(?:\s+(?:d[aeo]s?\s+)?[${MAI}][\p{L}'’]+){0,2}`;
const VOC = `(${VOC_COMUNS.map((w) => ci(escRe(w))).join("|")}|${NOME})`;
const FIM = String.raw`([!?.…]+)((?:\s*${EMO})*)`;
const VOC_FIM = new RegExp(String.raw`^(\p{L}.*?),\s+${VOC}\s*${FIM}$`, "u");
const VOC_INI = new RegExp(String.raw`^${VOC},\s+(\p{Ll}.*?)${FIM}$`, "u");
// Palavras que podem começar a frase e seguir minúsculas no meio dela.
const INICIOS = new Set(("continue continua siga segue sigam vamos vamo bora vem venha venham obrigado obrigada obrigados valeu força conte contem conto " +
  "contamos conta fique fica fiquem estamos seguimos sigamos juntos juntas bom boa feliz felizes muito muita que quem é foi tem temos sempre nunca " +
  "agora hoje amanhã aqui olha olhem veja vejam confira confiram sabe sabem acredite acreditem confie confiem somos sou estou vou vai viva avante " +
  "pra para rumo grande lindo linda orgulho gratidão saudade parabéns bem nossa nosso minha meu essa esse isso esta este um uma o a os as não sim " +
  "só mais tudo todo toda todos todas cada firme firmes seja sejam faça façam participe participem compartilhe compartilhem acompanhe acompanhem").split(" "));
// Palavras com maiúscula no começo da frase que NÃO são vocativo.
const NAO_VOC = new Set(("hoje agora aqui ali amanhã ontem sim não olha então enfim bom bem depois antes primeiro também sempre nunca obrigado obrigada " +
  "parabéns valeu oi olá ei e mas porém ou pois logo assim portanto contudo afinal inclusive aliás claro ok beleza pronto calma").split(" "));
const ABREV = new Set(["dr", "dra", "sr", "sra", "srta", "prof", "profa", "av", "dep", "ver", "gov", "pres", "sen", "eng", "adv", "cel", "gen", "ten", "cap", "maj", "sgt", "obs", "etc", "ex", "pág", "nº", "n"]);

// ----------------------------------------------------------------- emojis
const EQUIV = [["💪", "👊", "✊"], ["🔥", "⚡", "🚀"], ["👏", "🙌"], ["👇", "⬇️"], ["👉", "➡️"], ["✅", "✔️"], ["📢", "📣"], ["📍", "📌"], ["✨", "⭐", "🌟"], ["😍", "🥰"], ["😂", "🤣"], ["🎉", "🥳", "🎊"], ["📅", "🗓️"]];
const semVS = (e) => e.replace(/\uFE0F/g, "");
const CLASSE = new Map();
EQUIV.forEach((g, i) => g.forEach((e) => CLASSE.set(semVS(e), i)));
const EXTRA = ["👊", "💪", "🙌", "✨", "👏", "🔥", "✅", "📢"];
const PREFIXOS = ["📢", "📍", "👉", "✨"];

// ----------------------------------------------------------------- utilidades
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffle(arr, rng) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const minus = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const chave = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
const palavras = (s) => s.trim().split(/\s+/).filter(Boolean).length;

function casar(modelo, novo) {
  if (modelo === modelo.toUpperCase() && modelo !== modelo.toLowerCase()) return novo.toUpperCase();
  if (/^\p{Lu}/u.test(modelo)) return cap(novo);
  return novo;
}

function proteger(s) {
  const orig = [];
  const p = s.replace(new RegExp(PROT_SRC, "gu"), (m) => { orig.push(m); return `${PH_OPEN}${orig.length - 1}${PH_CLOSE}`; });
  return { p, orig };
}
const restaurar = (t, orig) => t.replace(new RegExp(PH_SRC, "g"), (_, i) => orig[Number(i)]);
const finalizar = (s) => s.split("\n").map((l) => l.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();

// Separa as linhas finais que só têm #hashtags (a "cauda") do resto do texto.
function separarCauda(t, orig) {
  const linhas = t.split("\n");
  let i = linhas.length;
  while (i > 0) {
    const l = linhas[i - 1];
    if (!l.trim()) { i--; continue; }
    const temPh = new RegExp(PH_SRC).test(l);
    const resto = l.replace(new RegExp(PH_SRC, "g"), (_, k) => (orig[Number(k)].startsWith("#") ? "" : "X")).trim();
    if (temPh && resto === "") { i--; continue; }
    break;
  }
  if (i >= linhas.length) return { corpo: t, sep: "", cauda: "", tags: [] };
  let j = i;
  while (j > 0 && !linhas[j - 1].trim()) j--;
  const cauda = linhas.slice(i).join("\n");
  return { corpo: linhas.slice(0, j).join("\n"), sep: "\n".repeat(i - j + 1), cauda, tags: cauda.match(new RegExp(PH_SRC, "g")) || [] };
}
const juntarCauda = (corpo, sep, cauda) => (cauda ? (corpo ? corpo + (sep || "\n\n") : "") + cauda : corpo);

// Frases de uma linha (não corta em "Dep." / "Dr."; emoji solto volta para a frase anterior).
function frases(linha) {
  const out = [];
  const re = /[.!?…]+(?=\s+\S)/gu;
  let ini = 0, m;
  while ((m = re.exec(linha))) {
    if (m[0] === ".") {
      const antes = linha.slice(ini, m.index).split(/\s+/).pop().toLowerCase().replace(/[^\p{L}º]/gu, "");
      if (ABREV.has(antes)) continue;
    }
    const fim = m.index + m[0].length;
    out.push(linha.slice(ini, fim).trim());
    ini = fim;
  }
  const resto = linha.slice(ini).trim();
  if (resto) out.push(resto);
  const res = [];
  const lead = new RegExp(String.raw`^((?:\s*${EMO})+)\s*`, "u");
  for (let f of out) {
    if (res.length) {
      const m2 = lead.exec(f);
      if (m2) { res[res.length - 1] += " " + m2[1].trim(); f = f.slice(m2[0].length); }
      if (!f.trim()) continue;
    }
    res.push(f);
  }
  return res;
}

// ----------------------------------------------------------------- transformações
function trocarExpressoes(t, rng, quantas) {
  const achados = [];
  GRUPOS_RE.forEach((formas, gi) => {
    formas.forEach((re) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(t))) achados.push({ gi, ini: m.index, fim: m.index + m[0].length, txt: m[0] });
    });
  });
  if (!achados.length) return { t, n: 0 };
  const escolhidos = [];
  const usados = new Set();
  for (const a of shuffle(achados, rng)) {
    if (escolhidos.length >= quantas) break;
    if (usados.has(a.gi)) continue;
    if (escolhidos.some((b) => a.ini < b.fim && b.ini < a.fim)) continue;
    usados.add(a.gi);
    escolhidos.push(a);
  }
  let out = t, n = 0;
  for (const a of escolhidos.sort((x, y) => y.ini - x.ini)) {
    const atual = chave(a.txt);
    const opcoes = GRUPOS[a.gi].formas.filter((f) => chave(f) !== atual);
    if (!opcoes.length) continue;
    out = out.slice(0, a.ini) + casar(a.txt, pick(opcoes, rng)) + out.slice(a.fim);
    n++;
  }
  return { t: out, n };
}

function vocativo(f) {
  let m = VOC_FIM.exec(f);
  if (m) {
    const [, resto, voc, pont, emo] = m;
    const primeira = resto.split(/\s+/)[0].toLowerCase();
    if (!INICIOS.has(primeira) || NAO_VOC.has(voc.toLowerCase()) || palavras(resto) > 10) return null;
    const comum = VOC_COMUNS.includes(voc.toLowerCase());
    return `${comum ? cap(voc.toLowerCase()) : voc}, ${minus(resto)}${pont}${emo}`;
  }
  m = VOC_INI.exec(f);
  if (m) {
    const [, voc, resto, pont, emo] = m;
    if (NAO_VOC.has(voc.toLowerCase()) || palavras(resto) > 10) return null;
    const comum = VOC_COMUNS.includes(voc.toLowerCase());
    return `${cap(resto)}, ${comum ? voc.toLowerCase() : voc}${pont}${emo}`;
  }
  return null;
}

function moverVocativo(t, rng) {
  const linhas = t.split("\n");
  const cands = [];
  linhas.forEach((l, li) => {
    if (!l.trim()) return;
    const fs = frases(l);
    fs.forEach((f, fi) => { const novo = vocativo(f); if (novo && novo !== f) cands.push({ li, fi, fs, novo }); });
  });
  if (!cands.length) return { t, n: 0 };
  const c = pick(cands, rng);
  const fs = [...c.fs];
  fs[c.fi] = c.novo;
  linhas[c.li] = fs.join(" ");
  return { t: linhas.join("\n"), n: 1 };
}

const FIM_DE_FRASE = new RegExp(String.raw`(?:[.!?…]|${EMO})\s*$`, "u");
const ITEM_DE_LISTA = /^\s*(?:[-•*–—]|\d+[.)]?\s)/u;
function mudarQuebras(t, orig, rng) {
  const { corpo, sep, cauda } = separarCauda(t, orig);
  const pars = corpo.split(/\n[ \t]*\n/);
  const opcoes = [];
  pars.forEach((par, i) => {
    const ls = par.split("\n");
    if (ls.length === 1) {
      const fs = frases(ls[0]);
      if (fs.length >= 2) opcoes.push(() => { pars[i] = fs.join("\n"); });
    } else if (ls.length <= 6 && ls.slice(0, -1).every((l) => FIM_DE_FRASE.test(l)) && !ls.some((l) => ITEM_DE_LISTA.test(l))) {
      opcoes.push(() => { pars[i] = ls.map((l) => l.trim()).join(" "); });
    }
  });
  if (!opcoes.length) return { t, n: 0 };
  pick(opcoes, rng)();
  return { t: juntarCauda(pars.join("\n\n"), sep, cauda), n: 1 };
}

function trocarEmojis(t, orig, rng) {
  let n = 0;
  let out = t.replace(emoRe(), (e) => {
    const k = CLASSE.get(semVS(e));
    if (k === undefined || rng() < 0.4) return e;
    const outros = EQUIV[k].filter((x) => semVS(x) !== semVS(e));
    n++;
    return pick(outros, rng);
  });
  if (rng() < 0.3) {
    const { corpo, sep, cauda } = separarCauda(out, orig);
    if (corpo.trim() && !new RegExp(String.raw`${EMO}\s*$`, "u").test(corpo)) { out = juntarCauda(`${corpo} ${pick(EXTRA, rng)}`, sep, cauda); n++; }
  }
  return { t: out, n };
}

function embaralharTags(t, orig, rng) {
  const { corpo, sep, cauda, tags } = separarCauda(t, orig);
  if (tags.length < 2) return { t, n: 0 };
  let nova = tags;
  for (let i = 0; i < 6 && nova.join(" ") === tags.join(" "); i++) nova = shuffle(tags, rng);
  const novoSep = corpo && rng() < 0.3 ? (sep === "\n" ? "\n\n" : "\n") : sep;
  const mudouSep = novoSep !== sep;
  if (nova.join(" ") === tags.join(" ") && !mudouSep) return { t, n: 0 };
  return { t: juntarCauda(corpo, novoSep, nova.join(" ")), n: 1 };
}

function candidato(p, meta, orig, rng) {
  let t = p, score = 0, mudou = false;
  const aplica = (r, peso) => { if (r && r.n) { t = r.t; score += peso * r.n; mudou = true; } };
  for (const op of shuffle(["expr", "voc", "quebra", "emoji", "tags"], rng)) {
    if (op === "expr" && rng() < 0.85) aplica(trocarExpressoes(t, rng, rng() < 0.5 ? 2 : 1), 3);
    else if (op === "voc" && rng() < 0.5) aplica(moverVocativo(t, rng), 3);
    else if (op === "quebra" && rng() < 0.4) aplica(mudarQuebras(t, orig, rng), 2);
    else if (op === "emoji" && meta.temEmoji && rng() < 0.6) aplica(trocarEmojis(t, orig, rng), 1);
    else if (op === "tags" && meta.tagsFim >= 2 && rng() < 0.6) aplica(embaralharTags(t, orig, rng), 1);
  }
  return { t, score, mudou };
}

// Último recurso: um emoji no começo e/ou no fim do texto (antes das hashtags).
function leves(bases, rng) {
  const out = [];
  const suf = shuffle(EXTRA, rng), pre = shuffle(PREFIXOS, rng);
  for (const s of bases) {
    const { p, orig } = proteger(s);
    const { corpo, sep, cauda } = separarCauda(p, orig);
    if (!corpo.trim()) continue;
    const add = (c) => out.push(finalizar(restaurar(juntarCauda(c, sep, cauda), orig)));
    for (const e of suf) add(`${corpo} ${e}`);
    for (const e of pre) add(`${e} ${corpo}`);
    for (const a of pre) for (const b of suf) add(`${a} ${corpo} ${b}`);
  }
  return out;
}

// Escolhe as versões mais diferentes entre si (e do original), não só as que mudam mais:
// pares de palavras (com a quebra de linha contando como palavra) medem a distância.
function pares(s) {
  const w = String(s).toLowerCase().replace(/\n+/g, " ¶ ").replace(/[^\p{L}\p{N}¶#@\s]/gu, " ").split(/\s+/).filter(Boolean);
  const out = new Set();
  for (let i = 0; i < w.length - 1; i++) out.add(`${w[i]} ${w[i + 1]}`);
  if (!out.size && w.length) out.add(w[0]);
  return out;
}
function distancia(a, b) {
  let comum = 0;
  for (const x of a) if (b.has(x)) comum++;
  const uniao = a.size + b.size - comum;
  return uniao ? 1 - comum / uniao : 0;
}
function escolherDiversas(achados, quer, base) {
  if (!achados.length) return [];
  const conj = achados.map((a) => pares(a.txt));
  const dBase = conj.map((c) => distancia(c, pares(base)));
  const maxScore = Math.max(1, ...achados.map((a) => a.score));
  const minD = [...dBase];
  const usado = new Array(achados.length).fill(false);
  const escolhidos = [];
  while (escolhidos.length < Math.min(quer, achados.length)) {
    let melhor = -1, valor = -Infinity;
    for (let i = 0; i < achados.length; i++) {
      if (usado[i]) continue;
      const v = achados[i].score / maxScore + 2 * minD[i];
      if (v > valor) { valor = v; melhor = i; }
    }
    usado[melhor] = true;
    escolhidos.push(achados[melhor].txt);
    for (let i = 0; i < achados.length; i++) if (!usado[i]) minD[i] = Math.min(minD[i], distancia(conj[i], conj[melhor]));
  }
  return escolhidos;
}

/**
 * Gera até `n` legendas diferentes da original (e de `evitar`), com o mesmo sentido.
 * @returns {{ variacoes: string[], fracas: number }} `fracas` = quantas só ganharam emoji.
 */
export function variarLegenda(texto, n, opts = {}) {
  const base = String(texto ?? "").replace(/\r\n/g, "\n").trim();
  const quer = Math.max(0, Math.min(50, Math.floor(Number(n)) || 0));
  if (!base || !quer) return { variacoes: [], fracas: 0 };
  const rng = mulberry32((hash(base) ^ (Number(opts.seed) | 0)) >>> 0);
  const { p, orig } = proteger(base);
  const meta = { temEmoji: emoRe().test(p), tagsFim: separarCauda(p, orig).tags.length };
  const vistos = new Set([chave(base), ...(opts.evitar || []).map(chave)]);
  const achados = [];
  const tentativas = Math.max(80, quer * 40);
  for (let i = 0; i < tentativas && achados.length < quer * 5; i++) {
    const c = candidato(p, meta, orig, rng);
    if (!c.mudou) continue;
    const txt = finalizar(restaurar(c.t, orig));
    const k = chave(txt);
    if (vistos.has(k) || txt.length > 2200) continue;
    vistos.add(k);
    achados.push({ txt, score: c.score + rng() * 0.5 });
  }
  const variacoes = escolherDiversas(achados, quer, base);
  let fracas = 0;
  if (variacoes.length < quer) {
    for (const txt of leves([base, ...variacoes], rng)) {
      if (variacoes.length >= quer) break;
      const k = chave(txt);
      if (vistos.has(k) || txt.length > 2200) continue;
      vistos.add(k);
      variacoes.push(txt);
      fracas++;
    }
  }
  return { variacoes, fracas };
}

// Para os testes.
export const __interno = { proteger, restaurar, separarCauda, frases, vocativo, trocarExpressoes, chave };
