"use strict";
// Logique pure (sans DOM) : lecture de la liste, choix du prochain compte. Testable sous Node.
//
// etat : { faits: {compte: "bloqué"|"déjà bloqué"|...}, exclus: [compte...], introuvables: {compte: true} }

// --- Lecture d'une liste fournie par l'utilisateur ---
// Accepte : un JSON (tableau de pseudos ou d'objets {compte, nom?, classement?, type?}, ou {comptes: [...]}),
// ou du texte : un pseudo (avec ou sans @) ou un lien instagram.com/pseudo par ligne (les lignes d'un CSV contenant un lien conviennent).
const PSEUDO = /^[a-z0-9._]{1,30}$/;
const CHEMINS_RESERVES = new Set(["p", "reel", "reels", "tv", "explore", "accounts", "stories", "direct", "about", "web", "api"]);

function pseudoValide(s) {
  if (typeof s !== "string") return null;
  const p = s.trim().replace(/^@/, "").toLowerCase();
  return PSEUDO.test(p) && !CHEMINS_RESERVES.has(p) && !p.endsWith(".") ? p : null;
}

function lireListe(texte) {
  const vus = new Map();
  const ajouter = (pseudo, extra = {}) => {
    const p = pseudoValide(pseudo);
    if (p && !vus.has(p)) vus.set(p, { nom: String(extra.nom || "@" + p), compte: p, type: extra.type || "", classement: extra.classement || "" });
  };

  let json;
  try { json = JSON.parse(texte); } catch (e) { json = undefined; }
  if (json !== undefined) {
    const items = Array.isArray(json) ? json : Array.isArray(json && json.comptes) ? json.comptes : [];
    for (const it of items) {
      if (typeof it === "string") {
        const m = it.match(/instagram\.com\/(?:_u\/)?([A-Za-z0-9._]+)/i);
        ajouter(m ? m[1] : it);
      } else if (it && typeof it === "object") ajouter(it.compte || it.username || it.pseudo, it);
    }
    return [...vus.values()];
  }

  for (const brut of String(texte).split(/\r?\n/)) {
    const ligne = brut.trim();
    const m = ligne.match(/instagram\.com\/(?:_u\/)?([A-Za-z0-9._]+)/i);
    ajouter(m ? m[1] : ligne);
  }
  return [...vus.values()];
}

// --- Suivi de la liste ---
function aTraiter(comptes, etat) {
  const exclus = new Set(etat.exclus);
  return comptes.filter((c) => !exclus.has(c.compte) && !etat.faits[c.compte] && !etat.introuvables[c.compte]);
}

// Pseudo du profil affiché si le chemin est exactement /pseudo/ (pas /pseudo/reels/, /explore/...), sinon null.
function compteDepuisChemin(chemin) {
  const m = /^\/([A-Za-z0-9._]+)\/?$/.exec(chemin);
  return m ? pseudoValide(m[1]) : null;
}

// Prochain compte à traiter, en sautant éventuellement celui qui est déjà affiché.
function prochain(comptes, etat, courant) {
  return aTraiter(comptes, etat).find((c) => c.compte !== courant) || null;
}

// Export explicite : ne pas compter sur le partage des const/let de premier niveau entre fichiers de content script.
const API_CORE = { lireListe, aTraiter, compteDepuisChemin, prochain };
if (typeof module !== "undefined") module.exports = API_CORE;
else globalThis.BlocageCore = API_CORE;
