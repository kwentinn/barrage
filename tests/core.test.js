const test = require("node:test");
const assert = require("node:assert");
const { lireListe, aTraiter, compteDepuisChemin, prochain } = require("../extension/core.js");

const comptes = ["a", "b", "c", "d", "e"].map((x) => ({ nom: x.toUpperCase(), compte: x }));
const neuf = () => ({ faits: {}, exclus: [], introuvables: {} });

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

test("aTraiter : exclut les comptes exclus, faits et introuvables", () => {
  const etat = { faits: { a: "bloqué" }, exclus: ["b"], introuvables: { c: true } };
  assert.deepEqual(aTraiter(comptes, etat).map((c) => c.compte), ["d", "e"]);
  assert.equal(aTraiter(comptes, neuf()).length, 5);
});

test("compteDepuisChemin : seulement /pseudo/ exact", () => {
  assert.equal(compteDepuisChemin("/Alexandre_Dupalais/"), "alexandre_dupalais");
  assert.equal(compteDepuisChemin("/bob"), "bob");
  for (const c of ["/", "/explore/", "/p/ABC/", "/reels/", "/bob/reels/", "/accounts/login/", "/direct/inbox/"]) assert.equal(compteDepuisChemin(c), null, c);
});

test("prochain : premier à traiter, en sautant le courant", () => {
  const etat = neuf();
  assert.equal(prochain(comptes, etat, null).compte, "a");
  assert.equal(prochain(comptes, etat, "a").compte, "b");
  etat.faits.a = "bloqué"; etat.exclus = ["b"];
  assert.equal(prochain(comptes, etat, "c").compte, "d");
  for (const c of comptes) etat.faits[c.compte] = "bloqué";
  assert.equal(prochain(comptes, etat, null), null);
});
