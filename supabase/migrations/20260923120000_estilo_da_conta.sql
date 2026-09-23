-- Estilo de legenda de cada conta (Contas → Estilo): o jeito de escrever
-- daquela conta (tom, público, gírias…). O "✨ Criar variações" do Criar e o
-- vary_captions da API mandam esse estilo para a IA reescrever a legenda
-- principal do jeito de cada conta. Vazio = mesmo tom da legenda principal.
-- O RLS de accounts (accounts_team) já cobre: só o time lê e edita.
alter table public.accounts add column if not exists caption_style text;
alter table public.accounts drop constraint if exists accounts_caption_style_len;
alter table public.accounts add constraint accounts_caption_style_len check (caption_style is null or char_length(caption_style) <= 300);
comment on column public.accounts.caption_style is 'Jeito de escrever desta conta para a IA das variações de legenda (até 300 caracteres).';
