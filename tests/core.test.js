const test = require("node:test");
const assert = require("node:assert");
const { lancer, aTraiter, attendre } = require("../extension/core.js");

const comptes = ["a", "b", "c", "d", "e"].map((x) => ({ nom: x.toUpperCase(), compte: x }));
const neuf = () => ({ faits: {}, exclus: [], introuvables: {} });
const instantane = async () => {};

// profils : compte -> {id, bloqueParMoi} | null | Error
function fauxApi(profils, { echecBloquer } = {}) {
  const appels = { profil: [], bloquer: [] };
  return {
    appels,
    profil: async (c) => {
      appels.profil.push(c);
      const p = c in profils ? profils[c] : { id: "id_" + c, bloqueParMoi: false };
      if (p instanceof Error) throw p;
      return p;
    },
    bloquer: async (id) => {
      appels.bloquer.push(id);
      if (echecBloquer === id) throw new Error("HTTP 429");
    },
  };
}
const base = (extra) => ({ comptes, etat: neuf(), options: { maxParSession: 50 }, attendre: instantane, ...extra });

test("cas nominal : tout est bloqué", async () => {
  const api = fauxApi({}); const etat = neuf();
  const r = await lancer(base({ api, etat }));
  assert.equal(r.raison, "termine");
  assert.equal(r.bloques, 5);
  assert.deepEqual(api.appels.bloquer, ["id_a", "id_b", "id_c", "id_d", "id_e"]);
  assert.equal(etat.faits.c, "bloqué");
});

test("déjà bloqué : aucun appel de blocage ; introuvable : mémorisé", async () => {
  const api = fauxApi({ a: { id: "x", bloqueParMoi: true }, b: null }); const etat = neuf();
  const r = await lancer(base({ api, etat }));
  assert.equal(r.dejaBloques, 1); assert.equal(r.introuvables, 1); assert.equal(r.bloques, 3);
  assert.ok(!api.appels.bloquer.includes("x"));
  assert.equal(etat.faits.a, "déjà bloqué"); assert.equal(etat.introuvables.b, true);
});

test("arrêt à la première erreur de blocage, sans insister", async () => {
  const api = fauxApi({}, { echecBloquer: "id_c" }); const etat = neuf();
  const r = await lancer(base({ api, etat }));
  assert.equal(r.raison, "erreur"); assert.match(r.erreur, /429/);
  assert.equal(r.bloques, 2); assert.equal(etat.faits.c, undefined);
  assert.deepEqual(api.appels.profil, ["a", "b", "c"]);
});

test("arrêt sur erreur de recherche de profil", async () => {
  const api = fauxApi({ b: new Error("HTTP 429") });
  const r = await lancer(base({ api }));
  assert.equal(r.raison, "erreur"); assert.equal(r.bloques, 1);
});

test("quota par session", async () => {
  const api = fauxApi({}); const etat = neuf();
  const r = await lancer(base({ api, etat, options: { maxParSession: 2 } }));
  assert.equal(r.raison, "quota"); assert.equal(r.bloques, 2);
  // reprise : seuls les restants sont traités
  const r2 = await lancer(base({ api, etat, options: { maxParSession: 2 } }));
  assert.equal(r2.bloques, 2); assert.deepEqual(Object.keys(etat.faits), ["a", "b", "c", "d"]);
});

test("comptes exclus, déjà faits et introuvables ignorés", async () => {
  const etat = { faits: { a: "bloqué" }, exclus: ["b"], introuvables: { c: true } };
  assert.deepEqual(aTraiter(comptes, etat).map((c) => c.compte), ["d", "e"]);
  const api = fauxApi({});
  await lancer(base({ api, etat }));
  assert.deepEqual(api.appels.profil, ["d", "e"]);
});

test("arrêt demandé par l'utilisateur, y compris pendant l'attente, avant tout blocage", async () => {
  const ctrl = new AbortController(); const api = fauxApi({});
  const attAbort = async () => ctrl.abort(); // l'utilisateur clique « Arrêter » pendant la pause
  const r = await lancer(base({ api, attendre: attAbort, signal: ctrl.signal }));
  assert.equal(r.raison, "arrete"); assert.equal(r.bloques, 0); assert.equal(api.appels.bloquer.length, 0);
});

test("délais respectés : 2-5 s avant blocage, puis délai configuré", async () => {
  const pauses = [];
  const api = fauxApi({});
  await lancer(base({ api, comptes: comptes.slice(0, 2), options: { delaiMinS: 30, delaiMaxS: 60, maxParSession: 9 },
    aleatoire: () => 0, attendre: async (ms) => { pauses.push(ms); } }));
  assert.deepEqual(pauses, [2000, 30000, 2000]); // pas de pause après le dernier compte
});

test("attendre() se résout immédiatement si signal annulé", async () => {
  const ctrl = new AbortController(); const t0 = Date.now();
  const p = attendre(5000, ctrl.signal); ctrl.abort(); await p;
  assert.ok(Date.now() - t0 < 500);
});

const { lireListe } = require("../extension/core.js");

test("lireListe : JSON d'objets, de chaînes, ou {comptes}", () => {
  assert.deepEqual(lireListe('[{"compte":"Marine_LePen","nom":"Marine Le Pen","classement":"x"},"@bob","https://www.instagram.com/_u/Alice/"]').map((c) => c.compte), ["marine_lepen", "bob", "alice"]);
  assert.equal(lireListe('[{"compte":"a_b","nom":"Nom"}]')[0].nom, "Nom");
  assert.deepEqual(lireListe('{"comptes":["x1","x2"]}').map((c) => c.compte), ["x1", "x2"]);
});

test("lireListe : texte, liens, doublons, lignes invalides, CSV avec liens", () => {
  const txt = "@Zed\n\nhttps://www.instagram.com/zed/\nhttps://instagram.com/p/ABC123/\nnom avec espaces\n#hashtag\nok.pseudo\n" +
    'Nom,Instagram,Type\r\nMarine,https://www.instagram.com/marine_lepen/,personne\r\n';
  assert.deepEqual(lireListe(txt).map((c) => c.compte), ["zed", "ok.pseudo", "marine_lepen"]);
});

test("lireListe : vide ou sans compte reconnu", () => {
  assert.deepEqual(lireListe(""), []);
  assert.deepEqual(lireListe("[1, null, {}]"), []);
  assert.deepEqual(lireListe("trop_long_" + "x".repeat(40)), []);
});
