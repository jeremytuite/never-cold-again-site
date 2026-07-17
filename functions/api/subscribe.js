// Cloudflare Pages Function: POST /api/subscribe
// Stores subscriber emails in KV. Bind a KV namespace as "VAULT_SUBS" in
// Pages project settings -> Functions -> KV namespace bindings.
export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const email = (body.email || "").trim().toLowerCase();
    const honeypot = (body.company || "").trim();

    if (honeypot) return json({ ok: true });

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
      return json({ ok: false, error: "invalid_email" }, 400);
    }

    const key = "sub:" + email;
    const existing = await env.VAULT_SUBS.get(key);
    if (!existing) {
      await env.VAULT_SUBS.put(key, JSON.stringify({
        email,
        ts: new Date().toISOString(),
        ua: request.headers.get("user-agent") || "",
        ref: request.headers.get("referer") || ""
      }));
    }
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: "server_error" }, 500);
  }
}

// GET /api/subscribe?export=csv&token=YOUR_SECRET -> CSV of all subscribers.
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (url.searchParams.get("export") !== "csv") return json({ ok: true, service: "vault-subscribe" });
  const token = url.searchParams.get("token") || "";
  if (!env.EXPORT_TOKEN || token !== env.EXPORT_TOKEN) return json({ ok: false, error: "unauthorized" }, 401);

  let cursor, rows = ["email,timestamp"];
  do {
    const page = await env.VAULT_SUBS.list({ prefix: "sub:", cursor });
    for (const k of page.keys) {
      const v = JSON.parse(await env.VAULT_SUBS.get(k.name) || "{}");
      rows.push((v.email || k.name.slice(4)) + "," + (v.ts || ""));
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return new Response(rows.join("\n"), {
    headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=vault-subscribers.csv" }
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
