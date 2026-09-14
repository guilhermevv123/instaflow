// InstaFlow · documentação da API: exemplos de código (cURL, JavaScript,
// Python, PHP) montados a partir da especificação, destaque de sintaxe e o
// arquivo OpenAPI 3.1 para importar no Postman, Insomnia, n8n etc.

export const LANGS = [["curl", "cURL"], ["javascript", "JavaScript"], ["python", "Python"], ["php", "PHP"]];

export const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fillPath = (path, params = {}) => path.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
const indent = (text, n) => text.split("\n").map((l, i) => (i ? " ".repeat(n) + l : l)).join("\n");
const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function pyLiteral(v, ind = 0) {
  const pad = "    ".repeat(ind), pad1 = "    ".repeat(ind + 1);
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => pad1 + pyLiteral(x, ind + 1)).join(",\n")},\n${pad}]` : "[]";
  const ks = Object.keys(v);
  return ks.length ? `{\n${ks.map((k) => `${pad1}${JSON.stringify(k)}: ${pyLiteral(v[k], ind + 1)}`).join(",\n")},\n${pad}}` : "{}";
}

const phpString = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/\n/g, "\\n")}"`;
function phpLiteral(v, ind = 0) {
  const pad = "  ".repeat(ind), pad1 = "  ".repeat(ind + 1);
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return phpString(v);
  if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => pad1 + phpLiteral(x, ind + 1)).join(",\n")},\n${pad}]` : "[]";
  const ks = Object.keys(v);
  return ks.length ? `[\n${ks.map((k) => `${pad1}${phpString(k)} => ${phpLiteral(v[k], ind + 1)}`).join(",\n")},\n${pad}]` : "new stdClass()";
}

export function urlOf(ep, base) {
  const ex = ep.example || {};
  return `${base}${fillPath(ep.path, ex.path)}${ex.query ? `?${ex.query}` : ""}`;
}

// Exemplo pronto para copiar, na linguagem pedida.
export function sample(lang, ep, base) {
  if (ep.extraSamples?.[lang]) return ep.extraSamples[lang].replaceAll("{BASE}", base);
  const url = urlOf(ep, base);
  const body = ep.example?.body;
  const hasBody = body !== undefined;
  const idem = (ep.headers || []).some((h) => h.name === "Idempotency-Key");
  const m = ep.method;
  if (lang === "curl") {
    const lines = [`curl -X ${m} "${url}"`, `  -H "Authorization: Bearer $INSTAFLOW_KEY"`];
    if (idem) lines.push(`  -H "Idempotency-Key: $(uuidgen)"`);
    if (hasBody) lines.push(`  -H "Content-Type: application/json"`, `  -d ${shellQuote(JSON.stringify(body, null, 2))}`);
    return lines.join(" \\\n");
  }
  if (lang === "javascript") {
    const headers = [`Authorization: \`Bearer \${process.env.INSTAFLOW_KEY}\`,`];
    if (hasBody) headers.push(`"Content-Type": "application/json",`);
    if (idem) headers.push(`"Idempotency-Key": crypto.randomUUID(), // um valor novo por operação`);
    return [
      `// Node 18+ (ou navegador, sem expor a chave em site público)`,
      `const resposta = await fetch("${url}", {`,
      `  method: "${m}",`,
      `  headers: {`,
      ...headers.map((h) => `    ${h}`),
      `  },`,
      ...(hasBody ? [`  body: JSON.stringify(${indent(JSON.stringify(body, null, 2), 2)}),`] : []),
      `});`,
      `const dados = await resposta.json();`,
      `if (!resposta.ok) throw new Error(\`\${resposta.status} \${dados.code ?? ""} \${dados.error}\`);`,
      `console.log(dados);`,
    ].join("\n");
  }
  if (lang === "python") {
    const headers = [`"Authorization": f"Bearer {os.environ['INSTAFLOW_KEY']}",`];
    if (idem) headers.push(`"Idempotency-Key": str(uuid.uuid4()),  # um valor novo por operação`);
    return [
      `import os`,
      ...(idem ? [`import uuid`] : []),
      `import requests  # pip install requests`,
      ``,
      `resposta = requests.${m.toLowerCase()}(`,
      `    "${url}",`,
      `    headers={`,
      ...headers.map((h) => `        ${h}`),
      `    },`,
      ...(hasBody ? [`    json=${indent(pyLiteral(body, 1), 0)},`] : []),
      `    timeout=60,`,
      `)`,
      `dados = resposta.json()`,
      `if not resposta.ok:`,
      `    raise RuntimeError(f"{resposta.status_code} {dados.get('code')} {dados.get('error')}")`,
      `print(dados)`,
    ].join("\n");
  }
  // php
  const headers = [`"Authorization: Bearer " . getenv("INSTAFLOW_KEY"),`];
  if (hasBody) headers.push(`"Content-Type: application/json",`);
  if (idem) headers.push(`"Idempotency-Key: " . bin2hex(random_bytes(16)),`);
  return [
    `<?php`,
    `$ch = curl_init("${url.replace(/\$/g, "\\$")}");`,
    `curl_setopt_array($ch, [`,
    `  CURLOPT_CUSTOMREQUEST => "${m}",`,
    `  CURLOPT_RETURNTRANSFER => true,`,
    `  CURLOPT_HTTPHEADER => [`,
    ...headers.map((h) => `    ${h}`),
    `  ],`,
    ...(hasBody ? [`  CURLOPT_POSTFIELDS => json_encode(${indent(phpLiteral(body, 1), 0)}, JSON_UNESCAPED_UNICODE),`] : []),
    `]);`,
    `$dados = json_decode(curl_exec($ch), true);`,
    `$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);`,
    `if ($status >= 400) {`,
    `  throw new Exception("$status " . ($dados["code"] ?? "") . " " . $dados["error"]);`,
    `}`,
    `print_r($dados);`,
  ].join("\n");
}

// ------------------------------------------------------------------ destaque de sintaxe
const RE_JSON = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g;
const RE_CODE = /((?:^|[ \t])(?:#|\/\/)[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\b(const|let|await|async|import|from|if|not|throw|new|return|print|print_r|raise|True|False|None|true|false|null|curl|function|echo)\b|(\b\d+(?:\.\d+)?\b)/gm;

export function highlight(src, lang) {
  const re = lang === "json" ? RE_JSON : RE_CODE;
  re.lastIndex = 0;
  let out = "", last = 0, m;
  while ((m = re.exec(src))) {
    if (m[0] === "") { re.lastIndex++; continue; }
    out += escHtml(src.slice(last, m.index));
    if (lang === "json") {
      if (m[1]) out += `<span class="${m[2] ? "t-key" : "t-str"}">${escHtml(m[1])}</span>${m[2] ? escHtml(m[2]) : ""}`;
      else if (m[3]) out += `<span class="t-kw">${m[3]}</span>`;
      else out += `<span class="t-num">${escHtml(m[4])}</span>`;
    } else if (m[1]) out += `<span class="t-com">${escHtml(m[1])}</span>`;
    else if (m[2]) out += `<span class="t-str">${escHtml(m[2])}</span>`;
    else if (m[3]) out += `<span class="t-kw">${m[3]}</span>`;
    else out += `<span class="t-num">${escHtml(m[4])}</span>`;
    last = re.lastIndex;
  }
  return out + escHtml(src.slice(last));
}

// ------------------------------------------------------------------ OpenAPI 3.1
const strip = (html) => String(html ?? "").replace(/<li>/g, "\n- ").replace(/<\/(p|ol|ul)>/g, "\n").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const camel = (id) => id.replace(/-(\w)/g, (_, c) => c.toUpperCase());

function schemaOf(f) {
  const t = String(f.type);
  let s;
  if (t.endsWith("[]")) s = { type: "array", items: { type: t.slice(0, -2) } };
  else if (t === "array") s = { type: "array", items: f.children ? { anyOf: [{ type: "string" }, objSchema(f.children)] } : {} };
  else if (t === "object") s = f.children ? objSchema(f.children) : { type: "object", additionalProperties: true };
  else if (t.includes("|")) s = { anyOf: t.split("|").map((x) => ({ type: x.trim() })) };
  else s = { type: t };
  if (f.enum) s.enum = f.enum;
  if (f.default !== undefined) s.default = f.default;
  if (f.desc) s.description = strip(f.desc);
  return s;
}
function objSchema(fields) {
  const s = { type: "object", properties: Object.fromEntries(fields.map((f) => [f.name, schemaOf(f)])) };
  const req = fields.filter((f) => f.required).map((f) => f.name);
  if (req.length) s.required = req;
  return s;
}

export function toOpenApi(groups, { base, version, errors, intro }) {
  const paths = {};
  for (const g of groups) {
    for (const ep of g.endpoints) {
      const params = [
        ...(ep.pathParams || []).map((p) => ({ name: p.name, in: "path", required: true, description: strip(p.desc), schema: schemaOf(p) })),
        ...(ep.query || []).map((p) => ({ name: p.name, in: "query", required: Boolean(p.required), description: strip(p.desc), schema: schemaOf(p) })),
        ...(ep.headers || []).map((p) => ({ name: p.name, in: "header", required: Boolean(p.required), description: strip(p.desc), schema: { type: "string" } })),
      ];
      const op = {
        operationId: camel(ep.id),
        summary: ep.title,
        description: strip(`${ep.summary}${ep.desc ? `\n\n${ep.desc}` : ""}`),
        tags: [g.title],
        security: [{ chave: [] }],
        ...(params.length ? { parameters: params } : {}),
        ...(ep.body ? { requestBody: { required: true, content: { "application/json": { schema: objSchema(ep.body), ...(ep.example?.body ? { example: ep.example.body } : {}) } } } } : {}),
        responses: {
          [String(ep.response?.status ?? 200)]: { description: "Sucesso", content: { "application/json": { example: ep.response?.body ?? {} } } },
          400: { $ref: "#/components/responses/Erro" },
          401: { $ref: "#/components/responses/Erro" },
          403: { $ref: "#/components/responses/Erro" },
          404: { $ref: "#/components/responses/Erro" },
          429: { $ref: "#/components/responses/Erro" },
        },
      };
      paths[ep.path] = { ...(paths[ep.path] || {}), [ep.method.toLowerCase()]: op };
    }
  }
  return {
    openapi: "3.1.0",
    info: { title: "InstaFlow API", version, description: intro },
    servers: [{ url: base }],
    security: [{ chave: [] }],
    tags: groups.map((g) => ({ name: g.title, description: strip(g.intro) })),
    components: {
      securitySchemes: { chave: { type: "http", scheme: "bearer", bearerFormat: "ifk_…", description: "Chave de acesso gerada em Config → API e integrações." } },
      schemas: {
        Erro: {
          type: "object",
          required: ["error"],
          properties: {
            error: { type: "string", description: "Mensagem em português do que aconteceu." },
            code: { type: "string", enum: [...new Set(errors.map((e) => e[1]).filter((c) => !c.startsWith("(")).flatMap((c) => c.split(" · ")))], description: "Código estável para o seu sistema decidir o que fazer." },
            details: { description: "Resposta do serviço de publicação, quando o erro veio dele." },
          },
        },
      },
      responses: { Erro: { description: "Erro (veja `code` e `error`)", content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } } } },
    },
    paths,
  };
}
