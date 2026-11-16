import {
  createClient,
  link,
  price,
  safeReturn,
  shopURL,
  target,
} from "../share/client.js";
const id = "11111111-1111-1111-1111-111111111111";
function assert(v) {
  if (!v) throw Error("Assertion failed");
}
const json = (v, status = 200) => new Response(JSON.stringify(v), { status });
function fixture(reply, session) {
  const values = new Map();
  if (session) values.set("varto.share.session", JSON.stringify(session));
  const calls = [];
  const storage = {
    getItem: (k) => values.get(k) || null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
  const client = createClient(
    { url: "https://fixture.supabase.co", key: "public-key" },
    storage,
    async (u, init) => {
      const c = {
        url: u,
        headers: init.headers,
        data: init.body ? JSON.parse(init.body) : null,
      };
      calls.push(c);
      return await reply(c);
    },
  );
  return { client, calls, values };
}
Deno.test("resource URLs, unsafe redirects and decimals", () => {
  for (const kind of ["profile", "wishlist", "item"]) {
    const t = target(link(kind, id));
    assert(t.kind === kind && t.id === id);
  }
  for (
    const p of [
      "https://evil.invalid/share/?kind=item&id=" + id,
      "//evil.invalid",
      "/auth/",
      "/share/?kind=item&id=nope",
    ]
  ) assert(safeReturn(p) === "/share/");
  assert(target("/share/?kind=item&id=" + id + "&offset=-1") === null);
  assert(
    shopURL("https://shop.invalid/?v=%2Fblue#details") ===
      "https://shop.invalid/?v=%2Fblue#details",
  );
  assert(shopURL("javascript:alert(1)") === null);
  assert(shopURL("https://u:p@shop.invalid") === null);
  assert(price({ price_amount: "12.50", currency: "EUR" }) === "12.50 EUR");
  assert(price({ price_amount: "0.00", currency: "XYZ" }) === "0.00 XYZ");
  assert(price({ price_amount: null, currency: "EUR" }) === "");
});
Deno.test("anonymous projection sends only public API key and never writes", async () => {
  const f = fixture(() => json(null));
  assert(!await f.client.verified());
  assert(await f.client.page({ kind: "wishlist", id, offset: 0 }) === null);
  assert(
    f.calls.length === 1 && f.calls[0].headers.Authorization === undefined,
  );
  assert(f.calls[0].data.p_id === id);
});
Deno.test("authenticated projection uses current viewer and refreshes expired session", async () => {
  const f = fixture(
    (c) =>
      c.url.endsWith("/user")
        ? json({}, 401)
        : c.url.includes("refresh_token")
        ? json({ access_token: "new", refresh_token: "r2" })
        : json({ kind: "item" }),
    { access_token: "old", refresh_token: "r1" },
  );
  assert(await f.client.verified());
  await f.client.page({ kind: "item", id, offset: 0 });
  assert(f.calls[2].headers.Authorization === "Bearer new");
});
Deno.test("auth outages never downgrade to anonymous", async () => {
  const f = fixture(() => json({}, 503), {
    access_token: "old",
    refresh_token: "refresh",
  });
  let failed = false;
  try {
    await f.client.verified();
  } catch {
    failed = true;
  }
  assert(failed && f.calls.length === 1 && f.client.isSignedIn());
});
Deno.test("email does not create users; complete OTP is required", async () => {
  const f = fixture(() => json({ access_token: "new", refresh_token: "r" }));
  await f.client.email("person@example.invalid");
  assert(f.calls[0].data.create_user === false);
  await f.client.verify("person@example.invalid", "12345678");
  assert(f.client.isSignedIn());
  let failed = false;
  try {
    await f.client.verify("person@example.invalid", "123");
  } catch {
    failed = true;
  }
  assert(failed && f.calls.length === 2);
});
Deno.test("OAuth uses PKCE, expires attempts and rejects missing verifier", async () => {
  const f = fixture(() => json({ access_token: "new", refresh_token: "r" }));
  const url = new URL(
    await f.client.google("https://www.varto.digital", link("item", id)),
  );
  const p = JSON.parse(f.values.get("varto.share.pkce"));
  assert(
    url.searchParams.get("redirect_to") ===
      "https://www.varto.digital/share/auth/",
  );
  assert(!url.href.includes(p.verifier));
  assert(url.searchParams.get("code_challenge_method") === "s256");
  assert(await f.client.callback("code") === link("item", id));
  assert(f.calls[0].data.code_verifier === p.verifier);
  let failed = false;
  try {
    await f.client.callback("code");
  } catch {
    failed = true;
  }
  assert(failed && f.calls.length === 1);
});
Deno.test("image permission check precedes exact Storage GET; denied or traversal paths never fetch", async () => {
  const f = fixture((c) =>
    c.url.includes("/rpc/")
      ? json({ bucket: "item-media", path: "owner/item/p.jpg" })
      : new Response(new Uint8Array([255, 216, 255]), {
        headers: { "content-type": "image/jpeg" },
      })
  );
  const blob = await f.client.image(id);
  assert(blob.size === 3 && f.calls.length === 2);
  assert(
    f.calls[1].url.endsWith(
      "/storage/v1/object/authenticated/item-media/owner/item/p.jpg",
    ),
  );
  for (
    const bad of [null, { bucket: "avatars", path: "p" }, {
      bucket: "item-media",
      path: "../p",
    }]
  ) {
    const x = fixture(() => json(bad));
    assert(await x.client.image(id) === null && x.calls.length === 1);
  }
});
Deno.test("SVG and oversized image are rejected", async () => {
  for (
    const headers of [{ "content-type": "image/svg+xml" }, {
      "content-type": "image/jpeg",
      "content-length": "10485761",
    }]
  ) {
    const f = fixture((c) =>
      c.url.includes("/rpc/")
        ? json({ bucket: "item-media", path: "p.jpg" })
        : new Response("x", { headers })
    );
    assert(await f.client.image(id) === null);
  }
});
Deno.test("logout clears browser session even when transport fails", async () => {
  const f = fixture(() => {
    throw Error("network");
  }, { access_token: "old", refresh_token: "r" });
  try {
    await f.client.logout();
  } catch { /* network */ }
  assert(!f.client.isSignedIn() && !f.values.has("varto.share.session"));
});

Deno.test("a delayed login cannot restore a session after logout", async () => {
  let finish;
  const f = fixture(() =>
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const pending = f.client.verify("person@example.invalid", "12345678").catch(
    () => {},
  );
  await f.client.logout();
  finish(json({ access_token: "late", refresh_token: "late" }));
  await pending;
  assert(!f.client.isSignedIn());
});
