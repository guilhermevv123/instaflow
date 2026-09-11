// Traduz as mensagens de erro mais comuns do Instagram/Post for Me para algo
// que a pessoa entende no painel. Mantém o texto original em `details`.
const RULES: Array<[RegExp, string]> = [
  [/reconnected|access token has expired|error validating access token|session has been invalidated|oauthexception.*190/i,
    "A conexão com esta conta venceu. Reconecte a conta em Contas."],
  [/media fetch failed|timeout downloading media|2207052|2207003/i,
    "O Instagram não conseguiu baixar a mídia. Tente de novo em alguns minutos."],
  [/aspect ratio|2207009/i,
    "A proporção da imagem não é aceita pelo Instagram (precisa ficar entre 4:5 e 1.91:1)."],
  [/2207026|video.*format|unsupported.*video|codec/i,
    "O formato do vídeo não é aceito. Use MP4 (H.264) com até 300 MB."],
  [/2207027|media type/i,
    "Tipo de mídia não aceito para este tipo de post."],
  [/2207051|application request limit|rate limit|too many/i,
    "Limite de publicações do Instagram atingido para esta conta. Aguarde e tente mais tarde."],
  [/2207050|content publishing limit|100 posts/i,
    "Esta conta já publicou 100 posts via API nas últimas 24 h. Aguarde para publicar mais."],
  [/not a confirmed user|user access is restricted|checkpoint/i,
    "O Instagram bloqueou esta conta temporariamente. Abra o app do Instagram e confirme a conta."],
  [/professional|business account|creator account|not eligible/i,
    "A conta precisa ser Profissional (Empresa ou Criador). Mude no app do Instagram e reconecte."],
  [/no media files found|media is required/i,
    "O post precisa de pelo menos uma foto ou vídeo."],
  [/all media failed to process|check media urls/i,
    "As mídias não puderam ser processadas. Verifique os arquivos e tente de novo."],
  [/api key is invalid/i,
    "A chave da API do Post for Me está inválida. Confira a chave nas configurações."],
];

export function friendlyError(raw: unknown): string {
  const text = typeof raw === "string" ? raw : raw ? JSON.stringify(raw) : "";
  if (!text) return "Falha desconhecida ao publicar.";
  for (const [re, msg] of RULES) if (re.test(text)) return msg;
  const clean = text.replace(/^Failed to post to Instagram\s*:\s*/i, "").trim();
  return clean.length > 220 ? clean.slice(0, 217) + "…" : clean;
}
