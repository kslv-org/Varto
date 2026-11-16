import { config } from "./config.js";
import { createClient, link, price, shopURL, target } from "./client.js";
const main = document.querySelector("main"),
  auth = document.querySelector("#auth");
const client = createClient(config, sessionStorage);
let revision = 0;
let showingPage = false;
const blobs = new Set();
function node(tag, text, cls) {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
function action(text, fn, cls = "button") {
  const b = node("button", text, cls);
  b.type = "button";
  b.addEventListener("click", fn);
  return b;
}
function anchor(text, url, cls = "button") {
  const a = node("a", text, cls);
  a.href = url;
  return a;
}
function clear() {
  showingPage = false;
  revision++;
  main.replaceChildren();
  for (const b of blobs) URL.revokeObjectURL(b);
  blobs.clear();
}
function message(text) {
  const p = node("p", text);
  p.setAttribute("role", "status");
  main.append(p);
}
function authButton() {
  auth.replaceChildren(
    action(client.isSignedIn() ? "Sign out" : "Sign in", async () => {
      if (client.isSignedIn()) {
        clear();
        await client.logout();
        await load();
      } else login();
    }, "button secondary"),
  );
}
function image(id, title, avatar = false) {
  const box = node("div", null, avatar ? "avatar" : "photo");
  box.setAttribute("role", "img");
  box.setAttribute("aria-label", "Photo unavailable");
  const generation = revision;
  client.image(id, avatar).then(async (blob) => {
    if (!blob || generation !== revision) return;
    const src = URL.createObjectURL(blob);
    blobs.add(src);
    const img = node("img");
    img.alt = title;
    img.src = src;
    try {
      await img.decode();
      if (generation === revision) {
        box.replaceChildren(img);
        box.removeAttribute("role");
        box.removeAttribute("aria-label");
      }
    } catch { /* keep placeholder */ }
  }).catch(() => {});
  return box;
}
function card(item) {
  const a = anchor("", link("item", item.id), "card");
  if (item.media[0]) a.append(image(item.media[0].id, item.title));
  a.append(node("h2", item.title), node("p", price(item)));
  return a;
}
function render(p, t) {
  clear();
  authButton();
  showingPage = true;
  if (!p) {
    main.append(node("h1", "This link is unavailable"));
    message("It may be private, removed, or no longer shared with you.");
    if (!client.isSignedIn()) {
      main.append(action("Sign in to check access", login));
    } else message("Ask the owner to check your access.");
    return;
  }
  if (p.profile) {
    if (p.profile.avatar_path) main.append(image(p.profile.id, "", true));
    main.append(node("h1", p.profile.display_name), node("h2", "Wishlists"));
    const grid = node("div", null, "grid");
    for (const w of p.wishlists || []) {
      const a = anchor("", link("wishlist", w.id), "card");
      a.append(
        node("h2", w.title),
        node(
          "p",
          w.visibility === "public" ? "Public" : "Shared with you",
          "muted",
        ),
      );
      grid.append(a);
    }
    main.append(grid);
  }
  if (p.kind === "wishlist") {
    main.append(
      node("h1", p.wishlist.title),
      node("p", p.wishlist.description),
    );
    const grid = node("div", null, "grid");
    for (const i of p.items || []) grid.append(card(i));
    main.append(grid);
    if (!p.items.length) message("No visible items.");
  }
  if (p.item) {
    const i = p.item;
    main.append(node("h1", i.title));
    const g = node("div", null, "gallery");
    for (const m of i.media) g.append(image(m.id, i.title));
    main.append(g, node("h2", price(i)), node("p", i.description));
    const actions = node("div", null, "actions");
    const shop = shopURL(i.source_url);
    if (shop) {
      const a = anchor("Shop", shop);
      a.rel = "noopener noreferrer";
      actions.append(a);
    }
    if (p.wishlist) {
      actions.append(
        anchor(
          p.wishlist.title,
          link("wishlist", p.wishlist.id),
          "button secondary",
        ),
      );
    }
    main.append(actions);
  }
  if (p.next_offset != null) {
    main.append(
      anchor(
        "Next page",
        link(t.kind, t.id, p.next_offset),
        "button secondary",
      ),
    );
  }
  const actions = node("div", null, "actions");
  actions.append(
    anchor(
      "Open in Varto",
      "varto://view/" + ({ profile: "p", wishlist: "w", item: "i" })[t.kind] +
        "/" + t.id,
    ),
  );
  main.append(actions);
}
async function load() {
  clear();
  message("Loading…");
  const generation = revision;
  try {
    await client.verified();
    const t = target(location.href);
    if (generation !== revision) return;
    if (!t) {
      clear();
      authButton();
      main.append(node("h1", "Shared with you"));
      message("Open a profile, wishlist or item link shared with you.");
      return;
    }
    const p = await client.page(t);
    if (generation !== revision) return;
    render(p, t);
  } catch {
    if (generation !== revision) return;
    clear();
    authButton();
    main.append(node("h1", "Please try again"));
    message("Varto could not load this page right now.");
    main.append(action("Retry", load));
  }
}
function input(form, label, type, name) {
  const l = node("label", label), i = node("input");
  i.type = type;
  i.name = name;
  i.required = true;
  l.append(i);
  form.append(l);
  return i;
}
function login(emailValue = "") {
  clear();
  authButton();
  main.append(node("h1", "Sign in to Varto"));
  message(
    "Use the account that already has access. Signing in does not grant access to a private list.",
  );
  const f = node("form");
  const email = input(f, "Email", "email", "email");
  email.value = typeof emailValue === "string" ? emailValue : "";
  email.autocomplete = "email";
  const submit = node("button", "Send sign-in code");
  submit.type = "submit";
  f.append(submit);
  main.append(f);
  const status = node("p");
  status.setAttribute("role", "status");
  main.append(status);
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    submit.disabled = true;
    const gen = revision;
    try {
      await client.email(email.value.trim());
      if (gen === revision) verify(email.value.trim());
    } catch (err) {
      if (gen === revision) status.textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });
  const actions = node("div", null, "actions");
  actions.append(
    action("Continue with Google", async () => {
      try {
        location.assign(
          await client.google(
            location.origin,
            location.pathname + location.search,
          ),
        );
      } catch {
        status.textContent = "Sign-in could not be started. Please try again.";
      }
    }, "button secondary"),
    action("Back", load, "button secondary"),
  );
  main.append(actions);
}
function verify(email) {
  clear();
  main.append(node("h1", "Check your email"));
  message("If this account can receive a code, enter it below.");
  const f = node("form");
  const code = input(f, "Email code", "text", "code");
  code.inputMode = "numeric";
  code.autocomplete = "one-time-code";
  code.pattern = "[0-9]{6,10}";
  code.maxLength = 10;
  const b = node("button", "Continue");
  b.type = "submit";
  f.append(b);
  main.append(f);
  const status = node("p");
  status.setAttribute("role", "status");
  main.append(status);
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    b.disabled = true;
    const gen = revision;
    try {
      await client.verify(email, code.value);
      if (gen === revision) await load();
    } catch (err) {
      if (gen === revision) status.textContent = err.message;
    } finally {
      b.disabled = false;
    }
  });
  main.append(
    action("Request another code", () => login(email), "button secondary"),
  );
}
// Private content and decoded image URLs are removed on background/BFCache entry.
addEventListener("pagehide", clear);
addEventListener("pageshow", (e) => {
  if (e.persisted) load();
});
let recheck = false;
document.addEventListener("visibilitychange", () => {
  if (document.hidden && showingPage) {
    recheck = true;
    clear();
  } else if (recheck) {
    recheck = false;
    load();
  }
});
if (location.pathname === "/share/auth/") {
  const code = new URL(location.href).searchParams.get("code");
  history.replaceState(null, "", "/share/auth/");
  try {
    location.replace(await client.callback(code));
  } catch (err) {
    clear();
    message(err.message);
    main.append(anchor("Back to Varto", "/share/"));
  }
} else await load();
