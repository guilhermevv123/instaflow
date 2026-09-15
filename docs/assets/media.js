// InstaFlow · upload e validação de mídia (regras do Instagram).
import { api, supa, team } from "./app.js";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/quicktime"];
const MB = 1024 * 1024;

export const LIMITS = {
  imageMaxBytes: 30 * MB,        // o Post for Me reencoda para JPEG ≤ 8 MB
  videoMaxBytes: 300 * MB,       // Reels/Feed
  storyVideoMaxBytes: 100 * MB,
  videoMinS: 3,
  videoMaxS: 15 * 60,
  storyVideoMaxS: 60,
  carouselVideoMaxS: 60,
  feedRatio: [4 / 5, 1.91],
};

export function kindOf(file) {
  if (IMAGE_TYPES.includes(file.type)) return "image";
  if (VIDEO_TYPES.includes(file.type)) return "video";
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (["jpg", "jpeg", "png", "webp"].includes(ext)) return "image";
  if (["mp4", "mov"].includes(ext)) return "video";
  return null;
}

// Lê dimensões/duração no navegador antes de subir.
export function probe(file) {
  const kind = kindOf(file);
  const url = URL.createObjectURL(file);
  return new Promise((resolve) => {
    if (kind === "image") {
      const img = new Image();
      img.onload = () => { resolve({ kind, width: img.naturalWidth, height: img.naturalHeight, duration: null, previewUrl: url }); };
      img.onerror = () => resolve({ kind, width: null, height: null, duration: null, previewUrl: url });
      img.src = url;
    } else if (kind === "video") {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => resolve({ kind, width: v.videoWidth, height: v.videoHeight, duration: v.duration, previewUrl: url });
      v.onerror = () => resolve({ kind, width: null, height: null, duration: null, previewUrl: url });
      v.src = url;
    } else {
      resolve({ kind: null, previewUrl: url });
    }
  });
}

// Devolve { errors: [], warnings: [] } para um arquivo num tipo de post.
export function validateItem(item, placement) {
  const errors = [], warnings = [];
  const { kind, size, width, height, duration } = item;
  if (!kind) { errors.push(`${item.name}: formato não aceito. Use JPG, PNG, WebP, MP4 ou MOV.`); return { errors, warnings }; }
  const ratio = width && height ? width / height : null;
  if (kind === "image") {
    if (size > LIMITS.imageMaxBytes) errors.push(`${item.name}: imagem acima de 30 MB.`);
    if (placement === "reels") errors.push(`${item.name}: Reels precisa de um vídeo, não de imagem.`);
    if (ratio && placement === "timeline" && (ratio < LIMITS.feedRatio[0] - 0.01 || ratio > LIMITS.feedRatio[1] + 0.01)) {
      warnings.push(`${item.name}: proporção fora de 4:5–1.91:1. Use ✂ Ajustar para escolher o corte (ou caber inteira).`);
    }
    if (width && width < 1080 && !item.adjusted) warnings.push(`${item.name}: foto pequena (${width} px de largura). O Instagram amplia e perde nitidez; prefira o arquivo original em vez de uma foto do WhatsApp.`);
    if (ratio && placement === "stories" && Math.abs(ratio - 9 / 16) > 0.05) warnings.push(`${item.name}: Stories fica melhor em 9:16; a imagem será ajustada.`);
  } else {
    const maxBytes = placement === "stories" ? LIMITS.storyVideoMaxBytes : LIMITS.videoMaxBytes;
    if (size > maxBytes) errors.push(`${item.name}: vídeo acima de ${Math.round(maxBytes / MB)} MB.`);
    if (duration && duration < LIMITS.videoMinS) errors.push(`${item.name}: vídeo com menos de 3 segundos.`);
    if (duration && placement === "stories" && duration > LIMITS.storyVideoMaxS) errors.push(`${item.name}: Story aceita vídeo de até 60 s.`);
    if (duration && placement !== "stories" && duration > LIMITS.videoMaxS) errors.push(`${item.name}: vídeo acima de 15 minutos.`);
    if (ratio && (placement === "reels" || placement === "stories") && Math.abs(ratio - 9 / 16) > 0.08) warnings.push(`${item.name}: Reels/Stories ficam melhor em vertical 9:16.`);
    if (item.type === "video/quicktime") warnings.push(`${item.name}: MOV costuma funcionar, mas MP4 (H.264) é mais seguro.`);
  }
  return { errors, warnings };
}

// `platforms`: redes das contas escolhidas (Set). Sem nenhuma, vale a regra do Instagram.
export function validateSet(items, placement, platforms = new Set()) {
  const errors = [], warnings = [];
  const p = platforms.size ? platforms : new Set(["instagram"]);
  const videos = items.filter((i) => i.kind === "video"), images = items.filter((i) => i.kind === "image");
  // Facebook, Threads, LinkedIn e Bluesky aceitam post só de texto; as outras precisam de mídia
  if (!items.length && ["instagram", "tiktok", "tiktok_business", "youtube"].some((r) => p.has(r))) errors.push("Adicione pelo menos uma foto ou vídeo.");
  if (items.length > 32) errors.push("Máximo de 32 itens por publicação.");
  if (p.has("instagram")) {
    if (items.length > 10) errors.push("Instagram: máximo de 10 itens no carrossel.");
    if (placement === "reels" && (items.length !== 1 || items[0]?.kind !== "video")) errors.push("Instagram: Reels precisa de exatamente um vídeo.");
    if (placement === "timeline" && items.length > 1) {
      const longVideo = items.find((i) => i.kind === "video" && i.duration > LIMITS.carouselVideoMaxS);
      if (longVideo) warnings.push("Vídeos dentro de carrossel ficam limitados a 60 s pelo Instagram.");
    }
    if (placement === "timeline" && items.length === 1 && items[0]?.kind === "video") warnings.push("Instagram: um vídeo no Feed é publicado como Reels e compartilhado no Feed.");
    if (placement === "stories" && items.length > 1) warnings.push(`Instagram: ${items.length} itens → serão ${items.length} Stories separados, em sequência.`);
  }
  if (p.has("facebook")) {
    if (items.length > 1 && videos.length) errors.push("Facebook: o carrossel só aceita fotos (o vídeo ficaria de fora).");
    if (placement === "reels" && (items.length !== 1 || items[0]?.kind !== "video")) errors.push("Facebook: Reels precisa de exatamente um vídeo.");
    if (placement === "stories" && items.length > 1) errors.push("Facebook: Stories aceita uma foto ou um vídeo por publicação.");
  }
  for (const [rede, nome] of [["tiktok", "TikTok"], ["tiktok_business", "TikTok Business"]]) {
    if (!p.has(rede)) continue;
    if (videos.length > 1 || (videos.length === 1 && images.length)) errors.push(`${nome}: ou um vídeo sozinho, ou só fotos (até 32).`);
    const big = images.find((i) => i.size > 20 * MB);
    if (big) errors.push(`${nome}: ${big.name} passa de 20 MB (limite para fotos).`);
    if (videos.length === 1 && videos[0].type && !["video/mp4", "video/quicktime", "video/webm"].includes(videos[0].type)) errors.push(`${nome}: vídeo precisa ser MP4, MOV ou WebM.`);
    if (images.length && !p.has("instagram")) warnings.push(`${nome} ajusta as fotos para 9:16, 3:4, 1:1 ou 16:9. Use ✂ Ajustar para escolher.`);
  }
  if (p.has("youtube")) {
    if (items.length && (items.length !== 1 || videos.length !== 1)) errors.push("YouTube: publique exatamente um vídeo (fotos não entram no YouTube).");
    else if (videos.length === 1 && videos[0].duration && videos[0].duration <= 180 && videos[0].height > videos[0].width) warnings.push("YouTube: vídeo vertical de até 3 minutos aparece como Shorts.");
  }
  if (p.has("threads") && items.length > 4) errors.push("Threads: no máximo 4 fotos ou vídeos por post.");
  if (p.has("linkedin")) {
    if (videos.length > 1 || (videos.length === 1 && images.length)) errors.push("LinkedIn: ou um vídeo sozinho, ou só fotos (até 20).");
    if (images.length > 20) errors.push("LinkedIn: no máximo 20 fotos por post.");
  }
  if (p.has("bluesky")) {
    if (videos.length > 1 || (videos.length === 1 && images.length)) errors.push("Bluesky: ou um vídeo sozinho, ou só fotos (até 4).");
    if (images.length > 4) errors.push("Bluesky: no máximo 4 fotos por post.");
  }
  for (const it of items) {
    // regras de arquivo do Instagram só quando ele está entre as redes escolhidas
    const r = p.has("instagram") ? validateItem(it, placement) : validateItem(it, placement === "reels" ? "timeline" : placement);
    if (!p.has("instagram")) { r.warnings = r.warnings.filter((w) => !/4:5–1\.91:1|Reels precisa/.test(w)); r.errors = r.errors.filter((e) => !/Reels precisa/.test(e)); }
    errors.push(...r.errors); warnings.push(...r.warnings);
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

// Sobe o arquivo para o Post for Me (URL assinada) e registra na biblioteca.
export async function uploadFile(file, meta, onProgress) {
  const { upload_url, media_url } = await api("/media/upload-url", { method: "POST" });
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", upload_url);
    xhr.setRequestHeader("Content-Type", file.type || (meta.kind === "video" ? "video/mp4" : "image/jpeg"));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload falhou (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error("Upload falhou. Verifique a conexão."));
    xhr.send(file);
  });
  const { data, error } = await supa.from("media").insert({
    team_id: team?.id,
    url: media_url,
    kind: meta.kind,
    name: file.name,
    mime: file.type || null,
    size_bytes: file.size,
    width: meta.width || null,
    height: meta.height || null,
    duration_s: meta.duration ? Number(meta.duration.toFixed(2)) : null,
  }).select("*").single();
  if (error) console.warn("biblioteca:", error.message);
  return { url: media_url, media: data };
}
