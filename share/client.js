export const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function target(input) {
  const u = new URL(input, "https://www.varto.digital");
  const kind = u.searchParams.get("kind"), id = u.searchParams.get("id");
  const offset = Number(u.searchParams.get("offset") || "0");
  if (
    u.pathname !== "/share/" ||
    !["profile", "wishlist", "item"].includes(kind) || !uuid.test(id || "") ||
    !Number.isSafeInteger(offset) || offset < 0 || offset > 2147483597
  ) return null;
  return { kind, id: id.toLowerCase(), offset };
}
export function link(kind, id, offset = 0) {
  return "/share/?" +
    new URLSearchParams({
      kind,
      id,
      ...(offset ? { offset: String(offset) } : {}),
    });
}
export function safeReturn(value) {
  const t = target(value || "/");
  return t && value.startsWith("/share/?")
    ? link(t.kind, t.id, t.offset)
    : "/share/";
}
export function shopURL(value) {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) && !u.username &&
        !u.password
      ? value
      : null;
  } catch {
    return null;
  }
}
export function price(item) {
  return item.price_amount === null
    ? ""
    : [item.price_amount, item.currency].filter((x) => x != null && x !== "")
      .join(" ");
}
export function createClient(config, storage, fetcher = fetch) {
  const base = new URL(config.url);
  if (
    base.protocol !== "https:" &&
    !(config.local && base.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(base.hostname))
  ) throw Error("Invalid API");
  const key = "varto.share.session";
  let session = null;
  let authRevision = 0;
  try {
    session = JSON.parse(storage.getItem(key));
  } catch { /* signed out */ }
  function save(value) {
    session = value;
    if (value) storage.setItem(key, JSON.stringify(value));
    else storage.removeItem(key);
  }
  async function api(path, data, token = session?.access_token) {
    const headers = { apikey: config.key, "Content-Type": "application/json" };
    // Modern publishable keys are not JWTs. Anonymous requests need only apikey.
    if (token || config.key.startsWith("eyJ")) {
      headers.Authorization = "Bearer " + (token || config.key);
    }
    const r = await fetcher(base.origin + path, {
      method: data === undefined ? "GET" : "POST",
      headers,
      body: data === undefined ? undefined : JSON.stringify(data),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    return r;
  }
  async function verified() {
    if (!session) return false;
    const revision = authRevision, original = session;
    const r = await api("/auth/v1/user");
    if (revision !== authRevision) return false;
    if (r.ok) return true;
    if (![401, 403].includes(r.status)) {
      throw Error("Sign-in is temporarily unavailable.");
    }
    const refresh = await api("/auth/v1/token?grant_type=refresh_token", {
      refresh_token: original.refresh_token,
    }, null);
    const value = refresh.ok ? await refresh.json() : null;
    if (revision !== authRevision) return false;
    if (refresh.ok) {
      save(value);
      return true;
    }
    if (refresh.status >= 500 || refresh.status === 429) {
      throw Error("Sign-in is temporarily unavailable.");
    }
    save(null);
    return false;
  }
  async function rpc(name, params) {
    const r = await api("/rest/v1/rpc/" + name, params);
    if (!r.ok) throw Error("This page could not be loaded. Please try again.");
    return await r.json();
  }
  async function accept(r, revision) {
    if (!r.ok) throw Error("Sign-in was not completed. Please try again.");
    const s = await r.json();
    if (!s.access_token || !s.refresh_token) throw Error("Invalid session");
    if (revision !== authRevision) {
      throw Error("Sign-in changed. Please try again.");
    }
    save(s);
  }
  const b64 = (bytes) =>
    btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll(
      "/",
      "_",
    ).replace(/=+$/, "");
  return {
    verified,
    isSignedIn: () => !!session,
    page: (t) =>
      rpc("share_page_v1", { p_kind: t.kind, p_id: t.id, p_offset: t.offset }),
    async image(id, avatar = false) {
      if (!uuid.test(id)) return null;
      const result = await rpc(
        avatar ? "share_page_v1" : "share_media_v1",
        avatar ? { p_kind: "profile", p_id: id } : { p_id: id },
      );
      const bucket = avatar ? "avatars" : result?.bucket,
        path = avatar ? result?.profile?.avatar_path : result?.path;
      if (
        !path || (!avatar && bucket !== "item-media") || path.includes("\\") ||
        path.split("/").some((p) => !p || p === "." || p === "..")
      ) return null;
      const r = await api(
        "/storage/v1/object/" + (avatar ? "public" : "authenticated") + "/" +
          bucket + "/" + path.split("/").map(encodeURIComponent).join("/"),
      );
      const mime = r.headers.get("content-type")?.split(";")[0];
      if (
        !r.ok ||
        !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime)
      ) {
        await r.body?.cancel();
        return null;
      }
      if (Number(r.headers.get("content-length")) > 10485760) {
        await r.body?.cancel();
        return null;
      }
      const reader = r.body.getReader();
      const chunks = [];
      let bytes = 0;
      try {
        for (;;) {
          const x = await reader.read();
          if (x.done) break;
          bytes += x.value.length;
          if (bytes > 10485760) return null;
          chunks.push(x.value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      return new Blob(chunks, { type: mime });
    },
    async email(email) {
      authRevision++;
      const r = await api("/auth/v1/otp", { email, create_user: false }, null);
      if (r.status >= 500 || r.status === 429) {
        throw Error(
          "Email sign-in is temporarily unavailable. Try again later.",
        );
      }
    },
    async verify(email, code) {
      const revision = ++authRevision;
      if (!/^\d{6,10}$/.test(code)) {
        throw Error("Enter the complete code from your email.");
      }
      await accept(
        await api(
          "/auth/v1/verify",
          { email, token: code, type: "email" },
          null,
        ),
        revision,
      );
    },
    async google(origin, next) {
      const verifier = b64(crypto.getRandomValues(new Uint8Array(32)));
      const challenge = b64(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(verifier),
          ),
        ),
      );
      storage.setItem(
        "varto.share.pkce",
        JSON.stringify({ verifier, next: safeReturn(next), at: Date.now() }),
      );
      const u = new URL(base.origin + "/auth/v1/authorize");
      u.search = new URLSearchParams({
        provider: "google",
        redirect_to: origin + "/share/auth/",
        code_challenge: challenge,
        code_challenge_method: "s256",
        scopes: "openid email profile",
      });
      return u.href;
    },
    async callback(code) {
      const revision = ++authRevision;
      let p;
      try {
        p = JSON.parse(storage.getItem("varto.share.pkce"));
      } catch { /* reject */ }
      storage.removeItem("varto.share.pkce");
      if (
        !code || !p || Date.now() - p.at > 600000 || !p.at ||
        !/^[A-Za-z0-9_-]{43}$/.test(p.verifier)
      ) throw Error("Sign-in expired. Open your shared link and try again.");
      await accept(
        await api("/auth/v1/token?grant_type=pkce", {
          auth_code: code,
          code_verifier: p.verifier,
        }, null),
        revision,
      );
      return safeReturn(p.next);
    },
    async logout() {
      authRevision++;
      const token = session?.access_token;
      save(null);
      if (token) await api("/auth/v1/logout?scope=local", {}, token);
    },
  };
}
