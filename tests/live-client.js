// Integration entrypoint: only disposable loopback Supabase fixtures are accepted.
import { createClient } from "../share/client.js";
const f = JSON.parse(
  await Deno.readTextFile(Deno.env.get("VARTO_SHARE_FIXTURE_FILE")),
);
if (new URL(f.url).hostname !== "127.0.0.1") throw Error("Loopback required");
function client(user) {
  const values = new Map();
  if (user) {
    values.set(
      "varto.share.session",
      JSON.stringify({ access_token: f.tokens[user], refresh_token: "unused" }),
    );
  }
  return createClient({ url: f.url, key: f.key, local: true }, {
    getItem: (k) => values.get(k) || null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  });
}
function assert(v) {
  if (!v) throw Error("Integration assertion failed");
}
const anon = client(),
  owner = client("owner"),
  other = client("other"),
  member = client("member");
for (
  const [c, id, visible] of [
    [anon, f.public, true],
    [anon, f.private, false],
    [other, f.private, false],
    [owner, f.private, true],
    [member, f.members, true],
  ]
) {
  await c.verified();
  const p = await c.page({ kind: "wishlist", id, offset: 0 });
  assert(Boolean(p) === visible);
}
const p = await anon.page({ kind: "item", id: f.item, offset: 0 });
assert(p.item.price_amount === "12.50" && p.item.currency === "XYZ");
assert(
  p.item.source_url === "https://shop.invalid/item?variant=%2Fblue#details",
);
const photo = await anon.image(f.media);
assert(photo && photo.size === f.photoSize);
const denied = await other.image(f.privateMedia);
assert(denied === null);
console.log(
  "PASS actual browser client: anon/owner/member/stranger, exact price/URL, authorized image bytes",
);
