// Diz de que conta se trata quando o Post for Me recusa a autorização com "External Id already
// exists for account …": só a rede e o nome (quem autorizou acabou de provar que manda nela),
// nunca de que outro time ela é. Só pelo painel.
import { pfm, PfmError, type PfmAccount } from "./pfm.ts";
import { type Caller, HttpError, type serviceClient } from "./util.ts";

type Db = ReturnType<typeof serviceClient>;

export async function lookupAccounts(db: Db, caller: Caller, body: { ids?: unknown }) {
  if (caller.via !== "jwt") throw new HttpError(403, "Esta consulta é feita só pelo painel.", "so_painel");
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.map(String))].filter((id) => /^spc_[A-Za-z0-9]{6,40}$/.test(id)).slice(0, 20) : [];
  if (!ids.length) throw new HttpError(400, "Mande ids: a lista de ids de conta (spc_…) que vieram no erro.");
  const { data: aqui, error } = await db.from("accounts").select("id, platform, username, archived").eq("team_id", caller.teamId).in("id", ids);
  if (error) throw new HttpError(500, error.message);
  const doTime = new Map((aqui ?? []).map((a) => [a.id as string, a]));
  const data = await Promise.all(ids.map(async (id) => {
    const a = doTime.get(id);
    if (a) return { id, here: true, archived: Boolean(a.archived), platform: a.platform, username: a.username };
    try {
      const p = await pfm<PfmAccount>(`/social-accounts/${encodeURIComponent(id)}`);
      return { id, here: false, platform: p.platform, username: p.username };
    } catch (e) {
      if (e instanceof PfmError && e.status === 404) return { id, here: false, platform: null, username: null };
      throw e;
    }
  }));
  return { data };
}
