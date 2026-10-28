"use strict";
// Barrage : blocage d'une liste importée, depuis votre session instagram.com.
// Un assistant en 4 étapes (liste, comptes, vérification, mode), puis un écran de suivi :
// - Pas à pas : un clic = un blocage (⋯ → Bloquer → Confirmer), puis ouverture du profil suivant.
// - Automatique : enchaîne les profils seul, avec des délais aléatoires, un plafond par session et un arrêt à la première erreur.
// Aucun appel d'API : c'est l'interface web d'Instagram qui travaille, avec votre session déjà ouverte.
// Pas de mot de passe, pas de serveur tiers.

(() => {
  if (document.getElementById("blocage-ig-hote")) return;
  const { aTraiter, lireListe, compteDepuisChemin, prochain } = globalThis.BlocageCore;
  const stockage = (typeof browser !== "undefined" ? browser : chrome).storage.local;
  const DELAI_ENTRE_BLOCAGES_S = 8;                                   // mode pas à pas
  const PAUSE_LONGUE = { tousLes: 5, minS: 60, maxS: 120 };           // mode automatique : pause plus longue tous les 5 blocages
  const CLE_ONGLET = "barrage-auto";                                  // le mode automatique ne tourne que dans l'onglet qui l'a lancé
  const PRESETS = {
    prudent: { nom: "Prudent", max: 10, a: 40, b: 90 },
    equilibre: { nom: "Équilibré", max: 15, a: 25, b: 60 },
    rapide: { nom: "Rapide", max: 25, a: 15, b: 35 },
  };
  const OPTIONS_PAR_DEFAUT = { preset: "prudent", delaiMinS: 40, delaiMaxS: 90, maxParSession: 10 };
  const ETAPES = ["liste", "comptes", "verif", "mode"];
  const ECRANS = [...ETAPES, "encours", "fin"];

  // --- État persistant ---
  let comptes = [];
  let etat = { faits: {}, exclus: [], introuvables: {} };
  let dernier = 0;      // horodatage du dernier blocage (délai minimal du mode pas à pas)
  let ouvert = false;   // panneau ouvert (mémorisé d'une page à l'autre)
  let ecran = "liste";  // écran affiché (mémorisé d'une page à l'autre)
  let confirme = false; // « J'ai compris » (étape 3)
  let mode = "pas";     // "pas" | "auto"
  let options = { ...OPTIONS_PAR_DEFAUT };
  let auto = { actif: false, bloques: 0, max: 0, prochainA: 0 };
  // --- État de session (non mémorisé) ---
  let occupe = false, statutAuto = "", enBoucle = false, autoAnnule = false;
  let brouillon = null, texteBrouillon = "", recherche = "", erreur = "", refs = {};
  const lignes = [];

  const sauver = () => stockage.set({ etat, liste: comptes, dernier, ouvert, options, auto, ecran, confirme, mode }).catch(() => {});
  const dansCetOnglet = () => { try { return sessionStorage.getItem(CLE_ONGLET) === "1"; } catch (e) { return false; } };
  const marquerOnglet = (oui) => { try { oui ? sessionStorage.setItem(CLE_ONGLET, "1") : sessionStorage.removeItem(CLE_ONGLET); } catch (e) {} };
  const aleaMs = (minS, maxS) => (minS + Math.random() * Math.max(0, maxS - minS)) * 1000;
  const pl = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;
  const dureeMin = (o) => Math.round((o.maxParSession * (o.delaiMinS + o.delaiMaxS) / 2
    + Math.floor(o.maxParSession / PAUSE_LONGUE.tousLes) * (PAUSE_LONGUE.minS + PAUSE_LONGUE.maxS) / 2) / 60);

  // --- Gestes sur l'interface d'Instagram ---
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const visible = (el) => el.getClientRects().length > 0;
  const RE_BLOQUER = /^(bloquer|block)$/i;
  const RE_DEBLOQUER = /^(débloquer|debloquer|unblock)(\s|$)/i; // aussi « Débloquer @compte », « Unblock user »…
  const RE_LIMITE = /réessayer plus tard|try again later|action bloquée|action blocked|nous limitons|we limit|activité suspecte|suspicious activity|patienter quelques minutes|wait a few minutes/i;

  async function attendreQue(fn, ms = 8000, pas = 150) {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > ms) return null;
      await pause(pas);
    }
  }
  const dialogues = () => [...document.querySelectorAll('[role="dialog"]')].filter(visible);
  const boutonsDe = (racine) => [...racine.querySelectorAll('button, [role="button"], [role="menuitem"]')].filter(visible);
  const trouver = (racine, re) => boutonsDe(racine).find((b) => re.test(norm(b.textContent)));
  const apercu = (racine) => boutonsDe(racine).map((b) => norm(b.textContent)).filter(Boolean).slice(0, 8).join(" | ") || "aucun bouton";
  const dernierDialogue = () => dialogues().at(-1) || null;

  // Instagram signale une limite ou une activité suspecte : on s'arrête, quoi qu'il arrive.
  function verifierLimite() {
    for (const d of dialogues()) {
      if (RE_LIMITE.test(d.textContent)) throw new Error(`Instagram signale une limite : « ${norm(d.textContent).slice(0, 120)} ». Arrêt par précaution.`);
    }
  }

  // Retourne "bloque" | "bloque-non-verifie" | "deja" | "introuvable", ou lève une erreur décrivant l'étape qui a échoué.
  async function executerBlocage() {
    verifierLimite();
    // 1. Profil déjà bloqué (bouton « Débloquer » sur la page) ou bouton « ⋯ » (aria-label « Options ») dans l'en-tête
    const pret = await attendreQue(() => {
      verifierLimite();
      if (trouver(document.body, RE_DEBLOQUER)) return "deja";
      const svg = document.querySelector('header svg[aria-label="Options"]') || document.querySelector('svg[aria-label="Options"]');
      return svg && (svg.closest('[role="button"], button') || svg.parentElement);
    });
    if (pret === "deja") return "deja";
    const boutonOptions = pret;
    if (!boutonOptions) {
      if (/n.est pas disponible|isn.t available|not available|introuvable/i.test(document.body.innerText)) return "introuvable";
      throw new Error(`Bouton « ⋯ » (Options) introuvable sur ce profil. L'interface d'Instagram a peut-être changé. Boutons vus : ${apercu(document.body)}.`);
    }
    boutonOptions.click();

    // 2. Menu : « Bloquer » (ou « Débloquer » si déjà fait)
    const menu = await attendreQue(dernierDialogue);
    if (!menu) throw new Error("Le menu du profil ne s'est pas ouvert.");
    verifierLimite();
    if (trouver(menu, RE_DEBLOQUER)) {
      const annuler = trouver(menu, /^(annuler|cancel)$/i);
      if (annuler) annuler.click(); else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return "deja";
    }
    const bloquer = trouver(menu, RE_BLOQUER);
    if (!bloquer) throw new Error(`Bouton « Bloquer » introuvable dans le menu. Boutons vus : ${apercu(menu)}.`);
    const texteMenu = norm(menu.textContent);
    bloquer.click();

    // 3. Confirmation : un nouveau bouton « Bloquer » exact (sinon on s'arrête : plusieurs choix possibles, à faire à la main)
    const confirmer = await attendreQue(() => {
      verifierLimite();
      const d = dernierDialogue();
      if (!d) return null;
      const b = trouver(d, RE_BLOQUER);
      return b && b !== bloquer && (norm(d.textContent) !== texteMenu) ? b : null;
    }, 6000);
    if (!confirmer) {
      const d = dernierDialogue();
      throw new Error(`Confirmation introuvable. Terminez à la main si besoin. Boutons vus : ${d ? apercu(d) : "aucune fenêtre"}.`);
    }
    confirmer.click();

    // 4. Fin : la fenêtre se ferme (éventuellement remplacée par un message à fermer) et « Débloquer » apparaît sur le profil
    await attendreQue(() => !document.contains(confirmer) || !visible(confirmer), 6000);
    await pause(500);
    verifierLimite();
    const info = dernierDialogue();
    const ok = info && trouver(info, /^(ok|fermer|close)$/i);
    if (ok) ok.click();
    const verifie = await attendreQue(() => trouver(document, RE_DEBLOQUER), 4000);
    return verifie ? "bloque" : "bloque-non-verifie";
  }

  // --- Interface (Shadow DOM pour ne pas heurter les styles d'Instagram) ---
  const hote = document.createElement("div");
  hote.id = "blocage-ig-hote";
  const o = hote.attachShadow({ mode: "open" });
  o.innerHTML = `
<style>
  * { box-sizing: border-box; font: 14px/1.45 system-ui, sans-serif; }
  #ouvrir { position: fixed; left: 16px; bottom: 16px; z-index: 2147483647; background: #b4231a; color: #fff; border: 0; border-radius: 20px; padding: 8px 14px; cursor: pointer; font-weight: 600; box-shadow: 0 2px 8px #0005; }
  #panneau { position: fixed; left: 16px; bottom: 56px; z-index: 2147483647; width: 340px; max-height: 80vh; overflow: auto; background: #fff; color: #1c1917; border: 1px solid #d6d3d1; border-radius: 12px; padding: 14px 16px 16px; box-shadow: 0 4px 20px #0005; }
  .haut { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .haut strong { font-size: 15px; }
  #menu { padding: 2px 8px; font-size: 16px; line-height: 1; }
  #menuliste { background: #f5f5f4; border-radius: 8px; padding: 6px; margin-bottom: 8px; display: grid; gap: 4px; }
  .etape { margin: 0 0 4px; font-size: 12px; color: #6b6560; }
  .dots { display: flex; gap: 4px; margin: 0 0 10px; } .dots i { flex: 1; height: 4px; border-radius: 2px; background: #e7e5e4; } .dots i.ok { background: #1c1917; }
  h3 { margin: 0 0 8px; font-size: 16px; }
  .txt { margin: 0 0 10px; color: #6b6560; font-size: 13px; }
  .petit { margin: 10px 0 0; color: #6b6560; font-size: 12px; }
  .rang { display: flex; gap: 8px; margin-top: 12px; } .rang > * { flex: 1; }
  button { cursor: pointer; border: 1px solid #d6d3d1; background: #fff; border-radius: 8px; padding: 7px 10px; color: inherit; }
  button.pri { background: #1c1917; border-color: #1c1917; color: #fff; font-weight: 600; }
  button.arret { background: #b4231a; border-color: #b4231a; color: #fff; font-weight: 600; }
  button:disabled { opacity: .5; cursor: default; } [hidden] { display: none !important; }
  button.lien { border: 0; background: none; padding: 0; color: #b4231a; text-decoration: underline; font-size: 12px; }
  textarea, input[type=search], input[type=number] { width: 100%; padding: 6px 8px; border: 1px solid #d6d3d1; border-radius: 8px; font: 13px/1.3 system-ui, sans-serif; }
  textarea { font-family: ui-monospace, monospace; font-size: 12px; resize: vertical; }
  input[type=number] { width: 64px; }
  .tint { background: #dcfce7; color: #14532d; border-radius: 8px; padding: 8px 10px; margin-top: 10px; font-size: 13px; }
  .resume { background: #f5f5f4; border-radius: 8px; padding: 8px 10px; margin: 8px 0; font-size: 13px; }
  .warn { background: #fef3c7; color: #713f12; border-radius: 8px; padding: 8px 10px; margin: 10px 0; font-size: 13px; }
  .err { color: #b4231a; font-size: 13px; margin: 8px 0 0; }
  .liste { max-height: 200px; overflow: auto; margin-top: 8px; }
  .ligne { display: flex; gap: 8px; align-items: center; padding: 3px 0; font-size: 13px; } .ligne em { margin-left: auto; font-style: normal; font-size: 12px; color: #166534; }
  .carte { display: block; width: 100%; text-align: left; margin: 0 0 8px; padding: 10px 12px; border-radius: 10px; }
  .carte.sel { border: 2px solid #b4231a; padding: 9px 11px; }
  .carte b { font-weight: 600; } .carte span { display: block; font-size: 12px; color: #6b6560; margin-top: 2px; }
  .seg { display: flex; gap: 6px; margin: 0 0 8px; } .seg button { flex: 1; padding: 6px 4px; } .seg button.sel { background: #fee2e2; border-color: #b4231a; color: #7f1d1d; font-weight: 600; }
  .bar { height: 6px; background: #e7e5e4; border-radius: 3px; margin: 6px 0 12px; overflow: hidden; } .bar div { height: 100%; width: 0; background: #166534; }
  .journal { background: #f5f5f4; border-radius: 8px; padding: 6px 8px; margin: 10px 0 0; font-size: 12px; white-space: pre-wrap; } .journal:empty { display: none; }
  .coches { display: flex; gap: 10px; margin-top: 6px; }
  details { margin-top: 6px; } summary { cursor: pointer; font-size: 12px; color: #6b6560; }
  .champs { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 6px; font-size: 13px; }
</style>
<button id="ouvrir" type="button">Barrage</button>
<section id="panneau" hidden>
  <div class="haut"><strong>Barrage</strong><button id="menu" type="button" aria-label="Menu" aria-expanded="false">⋯</button></div>
  <div id="menuliste" hidden>
    <button id="m-liste" type="button">Changer de liste</button>
    <button id="m-reset" type="button">Réinitialiser la progression</button>
  </div>
  <div id="contenu"></div>
</section>`;
  document.documentElement.append(hote);
  const $ = (id) => o.getElementById(id);

  // Petit constructeur DOM (aucune chaîne dynamique n'est interprétée comme du HTML).
  function h(tag, props = {}, ...enfants) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === false || v == null) continue;
      if (k === "class") el.className = v;
      else if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    el.append(...enfants.flat().filter((c) => c != null && c !== false));
    return el;
  }
  const btn = (texte, act, fn, cls = "") => h("button", { type: "button", class: cls, "data-act": act, on: { click: fn } }, texte);
  const rangee = (...b) => h("div", { class: "rang" }, b);
  const messageErreur = () => (erreur ? h("p", { class: "err", role: "alert" }, erreur) : null);

  function journal(txt) {
    lignes.push(txt); if (lignes.length > 6) lignes.shift();
    if (refs.journal) refs.journal.textContent = lignes.slice(-3).join("\n");
  }
  function allerA(e) { ecran = e; erreur = ""; recherche = ""; sauver(); rendre(); }
  const entete = (n, titre, texte) => [
    h("p", { class: "etape" }, `Étape ${n} sur 4`),
    h("div", { class: "dots" }, ETAPES.map((_, i) => h("i", { class: i < n ? "ok" : "" }))),
    h("h3", {}, titre),
    texte ? h("p", { class: "txt" }, texte) : null,
  ];
  const retour = (vers) => btn("Retour", "retour", () => allerA(vers));

  // --- Étape 1 : la liste ---
  function majResultatListe() {
    const r = refs.resultat; if (!r) return;
    let txt = "", bon = false;
    if (brouillon) {
      bon = brouillon.length > 0;
      txt = bon ? `${pl(brouillon.length, "compte")} reconnu${brouillon.length > 1 ? "s" : ""}` : "Aucun compte reconnu : un pseudo ou un lien par ligne.";
    } else if (comptes.length) { bon = true; txt = `Liste actuelle : ${pl(comptes.length, "compte")}. Collez-en une autre pour la remplacer.`; }
    r.textContent = txt; r.className = bon ? "tint" : "warn"; r.hidden = !txt;
  }
  function validerListe() {
    if (brouillon && brouillon.length) { comptes = brouillon; brouillon = null; texteBrouillon = ""; }
    else if (brouillon) { erreur = "Aucun compte reconnu. Collez un pseudo ou un lien par ligne."; return rendre(); }
    else if (!comptes.length) { erreur = "Ajoutez une liste pour continuer."; return rendre(); }
    allerA("comptes");
  }
  function ecranListe() {
    const zone = h("textarea", { rows: 5, placeholder: "@pseudo\nhttps://www.instagram.com/pseudo/", value: texteBrouillon, "aria-label": "Liste de comptes" });
    zone.addEventListener("input", () => { texteBrouillon = zone.value; brouillon = texteBrouillon.trim() ? lireListe(texteBrouillon) : null; erreur = ""; majResultatListe(); });
    const fichier = h("input", { type: "file", accept: ".json,.txt,.csv,text/plain,application/json", hidden: true });
    fichier.addEventListener("change", async () => {
      const f = fichier.files[0]; fichier.value = "";
      if (f) { texteBrouillon = await f.text(); zone.value = texteBrouillon; brouillon = lireListe(texteBrouillon); majResultatListe(); }
    });
    refs.resultat = h("div", { hidden: true });
    queueMicrotask(majResultatListe);
    return [
      ...entete(1, "Votre liste de comptes", "Collez des pseudos, un par ligne, ou choisissez un fichier (texte ou JSON)."),
      zone, fichier,
      rangee(btn("Choisir un fichier…", "fichier", () => fichier.click())),
      refs.resultat, messageErreur(),
      rangee(btn("Continuer", "continuer", validerListe, "pri")),
    ];
  }

  // --- Étape 2 : les comptes ---
  function ecranComptes() {
    const compteur = h("p", { class: "txt", style: "margin:8px 0 0" });
    const zoneListe = h("div", { class: "liste" });
    const majCompteur = () => {
      const ex = new Set(etat.exclus);
      compteur.textContent = `${comptes.filter((c) => !ex.has(c.compte)).length} sur ${comptes.length} sélectionnés`;
    };
    const visibles = () => { const q = recherche.trim().toLowerCase(); return comptes.filter((c) => !q || (c.nom + " " + c.compte).toLowerCase().includes(q)); };
    const remplir = () => {
      const ex = new Set(etat.exclus);
      zoneListe.replaceChildren(...visibles().map((c) => {
        const cb = h("input", { type: "checkbox", checked: !ex.has(c.compte) });
        cb.addEventListener("change", () => {
          const s = new Set(etat.exclus); cb.checked ? s.delete(c.compte) : s.add(c.compte);
          etat.exclus = [...s]; sauver(); majCompteur();
        });
        const statut = etat.faits[c.compte] || (etat.introuvables[c.compte] ? "introuvable" : "");
        return h("label", { class: "ligne", title: `@${c.compte}${c.classement ? " · " + c.classement : ""}` }, cb, c.nom, statut ? h("em", {}, statut) : null);
      }));
    };
    const tout = (coche) => {
      const s = new Set(etat.exclus);
      for (const c of visibles()) coche ? s.delete(c.compte) : s.add(c.compte);
      etat.exclus = [...s]; sauver(); remplir(); majCompteur();
    };
    const champ = h("input", { type: "search", placeholder: "Rechercher un nom", value: recherche, "aria-label": "Rechercher un nom" });
    champ.addEventListener("input", () => { recherche = champ.value; remplir(); });
    remplir(); majCompteur();
    return [
      ...entete(2, "Qui voulez-vous bloquer ?", "Décochez les comptes à épargner."),
      champ, zoneListe, compteur,
      h("div", { class: "coches" }, btn("Tout cocher", "tout-cocher", () => tout(true), "lien"), btn("Tout décocher", "tout-decocher", () => tout(false), "lien")),
      messageErreur(),
      rangee(retour("liste"), btn("Continuer", "continuer", () => {
        if (!aTraiter(comptes, etat).length) { erreur = "Aucun compte à bloquer : cochez-en au moins un."; return rendre(); }
        allerA("verif");
      }, "pri")),
    ];
  }

  // --- Étape 3 : vérification ---
  function ecranVerif() {
    const n = aTraiter(comptes, etat).length;
    const cb = h("input", { type: "checkbox", checked: confirme });
    cb.addEventListener("change", () => { confirme = cb.checked; erreur = ""; sauver(); if (refs.erreur) refs.erreur.hidden = true; });
    refs.erreur = h("p", { class: "err", role: "alert", hidden: !erreur }, erreur);
    return [
      ...entete(3, "Avant de commencer", `${pl(n, "compte")} ${n > 1 ? "seront bloqués" : "sera bloqué"} depuis votre session Instagram, avec les gestes habituels : ⋯, Bloquer, Confirmer.`),
      h("div", { class: "resume" },
        "• Les comptes déjà bloqués sont sautés.", h("br"),
        "• Arrêt automatique si Instagram change ou signale une limite.", h("br"),
        "• Aucun mot de passe, aucune donnée envoyée."),
      h("div", { class: "warn" }, "Cet outil automatise l'interface d'Instagram, hors de ses conditions d'utilisation. Votre compte peut être limité temporairement."),
      h("label", { class: "ligne" }, cb, "J'ai compris"),
      refs.erreur,
      rangee(retour("comptes"), btn("Continuer", "continuer", () => {
        if (!confirme) { erreur = "Cochez la case pour continuer."; refs.erreur.textContent = erreur; refs.erreur.hidden = false; return; }
        allerA("mode");
      }, "pri")),
    ];
  }

  // --- Étape 4 : le mode ---
  function choisirPreset(cle) { const p = PRESETS[cle]; options = { preset: cle, delaiMinS: p.a, delaiMaxS: p.b, maxParSession: p.max }; sauver(); rendre(); }
  function lireReglages(champs) {
    const n = (el, min, max, def) => { const v = parseInt(el.value, 10); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def; };
    const a = n(champs.a, 15, 600, OPTIONS_PAR_DEFAUT.delaiMinS);
    options = { preset: "perso", delaiMinS: a, delaiMaxS: Math.max(a, n(champs.b, 15, 600, OPTIONS_PAR_DEFAUT.delaiMaxS)), maxParSession: n(champs.m, 1, 30, OPTIONS_PAR_DEFAUT.maxParSession) };
    sauver(); rendre();
  }
  function blocAuto() {
    const champs = {
      a: h("input", { type: "number", min: 15, max: 600, value: options.delaiMinS, "aria-label": "Délai minimum en secondes" }),
      b: h("input", { type: "number", min: 15, max: 600, value: options.delaiMaxS, "aria-label": "Délai maximum en secondes" }),
      m: h("input", { type: "number", min: 1, max: 30, value: options.maxParSession, "aria-label": "Maximum de blocages par session" }),
    };
    for (const el of Object.values(champs)) el.addEventListener("change", () => lireReglages(champs));
    return h("div", { style: "margin:0 0 8px" },
      h("div", { class: "seg" }, Object.entries(PRESETS).map(([cle, p]) =>
        h("button", { type: "button", class: options.preset === cle ? "sel" : "", "data-act": "preset-" + cle, "aria-pressed": String(options.preset === cle), on: { click: () => choisirPreset(cle) } }, p.nom))),
      h("div", { class: "resume" },
        `${options.maxParSession} blocages maximum`, h("br"),
        `${options.delaiMinS} à ${options.delaiMaxS} s entre deux`, h("br"),
        `Environ ${dureeMin(options)} min au total`),
      options.preset === "rapide" ? h("div", { class: "warn" }, "Plus rapide, donc plus risqué.") : null,
      h("details", { class: "avance" }, h("summary", {}, "Réglages avancés"),
        h("div", { class: "champs" }, "Entre deux blocages", champs.a, "à", champs.b, "s"),
        h("div", { class: "champs" }, "Maximum par session", champs.m),
        h("p", { class: "petit" }, "Une pause de 1 à 2 min s'ajoute tous les 5 blocages. Gardez l'onglet ouvert.")));
  }
  const carte = (cle, titre, suffixe, texte) => h("button", {
    type: "button", class: "carte" + (mode === cle ? " sel" : ""), "data-act": "mode-" + cle, "aria-pressed": String(mode === cle),
    on: { click: () => { mode = cle; sauver(); rendre(); } },
  }, h("b", {}, titre), suffixe, h("span", {}, texte));
  function ecranMode() {
    return [
      ...entete(4, "Comment bloquer ?"),
      carte("pas", "Pas à pas", " · recommandé", "Vous cliquez pour chaque profil. Le plus sûr."),
      carte("auto", "Automatique", "", "L'extension enchaîne les profils seule. Plus pratique, plus risqué."),
      mode === "auto" ? blocAuto() : null,
      messageErreur(),
      rangee(retour("verif"), btn(mode === "auto" ? "Lancer" : "Démarrer", "demarrer", demarrer, "pri")),
    ];
  }

  // --- Écran de suivi ---
  function ecranEncours() {
    const enAuto = auto.actif;
    refs.titre = h("h3", {}); refs.sous = h("p", { class: "txt", style: "margin:0" });
    refs.barre = h("div", {}); refs.journal = h("div", { class: "journal", role: "status", "aria-live": "polite" }, lignes.slice(-3).join("\n"));
    const haut = [h("p", { class: "etape" }, enAuto ? "Mode automatique" : "Pas à pas"), refs.titre, refs.sous, h("div", { class: "bar" }, refs.barre)];
    let corps;
    if (enAuto) {
      refs.statut = h("div", { class: "resume", style: "margin-top:0" });
      refs.session = h("p", { class: "petit", style: "margin:6px 0 8px" });
      corps = [refs.statut, refs.session, rangee(btn("Arrêter le mode automatique", "arreter", () => arreterAuto("Mode automatique arrêté."), "arret"))];
    } else {
      refs.btnBloquer = btn("Bloquer et passer au suivant", "bloquer", bloquerCourant, "pri");
      refs.btnAller = btn("Ouvrir le prochain profil", "aller", () => passerAuSuivant(null), "pri");
      refs.btnFait = btn("Déjà bloqué", "fait", marquerFait); refs.btnPasser = btn("Passer", "passer", passerCompte);
      refs.rangeeSecondaire = rangee(refs.btnFait, refs.btnPasser);
      corps = [rangee(refs.btnBloquer, refs.btnAller), refs.rangeeSecondaire, h("p", { class: "petit" }, `Au moins ${DELAI_ENTRE_BLOCAGES_S} s entre deux blocages.`)];
    }
    return [...haut, ...corps, refs.journal,
      h("div", { class: "coches", style: "margin-top:12px" },
        btn("Modifier les réglages", "reglages", () => { if (auto.actif) arreterAuto(); allerA("mode"); }, "lien"),
        btn("Changer la sélection", "selection", () => { if (auto.actif) arreterAuto(); allerA("comptes"); }, "lien"))];
  }

  function ecranFin() {
    const vals = Object.values(etat.faits);
    const bloques = vals.filter((v) => v.startsWith("bloqué")).length;
    const deja = vals.filter((v) => v === "déjà bloqué").length;
    const introuvables = Object.keys(etat.introuvables).length;
    return [
      h("p", { class: "etape" }, "Terminé"),
      h("h3", {}, "Tous les comptes sont traités"),
      h("div", { class: "resume" },
        `${pl(bloques, "compte")} ${bloques > 1 ? "bloqués" : "bloqué"}`, h("br"),
        `${pl(deja, "compte")} ${deja > 1 ? "étaient" : "était"} déjà bloqué${deja > 1 ? "s" : ""}`, h("br"),
        `${pl(introuvables, "profil")} introuvable${introuvables > 1 ? "s" : ""}`, h("br"),
        `${pl(etat.exclus.length, "compte")} épargné${etat.exclus.length > 1 ? "s" : ""}`),
      rangee(btn("Charger une autre liste", "autre-liste", () => allerA("liste")), btn("Fermer", "fermer", () => { ouvert = false; sauver(); rendre(); }, "pri")),
    ];
  }

  function rendre() {
    $("panneau").hidden = !ouvert;
    refs = {};
    const ecrans = { liste: ecranListe, comptes: ecranComptes, verif: ecranVerif, mode: ecranMode, encours: ecranEncours, fin: ecranFin };
    $("contenu").replaceChildren(...ecrans[ecran]().filter(Boolean));
    majDynamique();
  }

  // Parties vivantes de l'écran de suivi (compte à rebours, boutons) ; la navigation d'Instagram ne recharge pas toujours la page.
  function majDynamique() {
    if (ecran === "encours" && !auto.actif && !occupe && comptes.length && !aTraiter(comptes, etat).length) { ecran = "fin"; sauver(); rendre(); return; }
    if (ecran !== "encours" || !refs.titre) return;
    const courant = compteDepuisChemin(location.pathname);
    const cible = comptes.find((c) => c.compte === courant && aTraiter([c], etat).length) || null;
    const suivant = prochain(comptes, etat, cible && cible.compte);
    const ex = new Set(etat.exclus), actifs = comptes.filter((c) => !ex.has(c.compte));
    const nFaits = actifs.filter((c) => etat.faits[c.compte]).length;
    const cur = cible || suivant;
    refs.titre.textContent = cur ? cur.nom : "Terminé";
    refs.sous.textContent = `${cur ? "@" + cur.compte + " · " : ""}${nFaits} sur ${actifs.length} traités`;
    refs.barre.style.width = actifs.length ? (100 * nFaits / actifs.length) + "%" : "0";
    if (auto.actif) {
      refs.statut.textContent = dansCetOnglet() ? (statutAuto || "En cours…") : "Mode automatique actif dans un autre onglet (ou onglet fermé).";
      refs.session.textContent = `${auto.bloques} sur ${auto.max} blocages cette session`;
      return;
    }
    const restant = Math.max(0, Math.ceil((dernier + DELAI_ENTRE_BLOCAGES_S * 1000 - Date.now()) / 1000));
    refs.btnBloquer.hidden = !cible;
    refs.btnBloquer.disabled = occupe || restant > 0;
    refs.btnBloquer.textContent = occupe ? "En cours…" : restant > 0 ? `Patientez ${restant} s…` : "Bloquer et passer au suivant";
    refs.btnAller.hidden = !!cible || !suivant; refs.btnAller.disabled = occupe;
    refs.rangeeSecondaire.hidden = !cible; refs.btnFait.disabled = occupe; refs.btnPasser.disabled = occupe;
  }

  // --- Moteur ---
  async function passerAuSuivant(compte) {
    const suivant = prochain(comptes, etat, compte);
    if (!suivant) { journal("Terminé : tous les comptes sélectionnés sont traités."); majDynamique(); return; }
    ouvert = true;
    await sauver();
    location.assign(`/${suivant.compte}/`);
  }

  // Traite le profil affiché (met à jour l'état) ; lève une erreur si une étape échoue.
  async function traiterCourant(cible) {
    journal(`@${cible.compte}…`);
    const res = await executerBlocage();
    if (res === "introuvable") { etat.introuvables[cible.compte] = true; journal(`? @${cible.compte} introuvable (renommé ou supprimé)`); }
    else if (res === "deja") { etat.faits[cible.compte] = "déjà bloqué"; journal(`= ${cible.nom} déjà bloqué`); }
    else {
      etat.faits[cible.compte] = "bloqué"; dernier = Date.now();
      journal(res === "bloque" ? `✓ ${cible.nom} bloqué` : `✓ ${cible.nom} : blocage envoyé, non vérifié (vérifiez le profil)`);
    }
    await sauver(); majDynamique();
    return res;
  }

  // Mode pas à pas
  async function bloquerCourant() {
    const courant = compteDepuisChemin(location.pathname);
    const cible = comptes.find((c) => c.compte === courant && aTraiter([c], etat).length);
    if (!cible || occupe) return;
    occupe = true; majDynamique();
    try {
      await traiterCourant(cible);
      await passerAuSuivant(cible.compte);
    } catch (e) {
      journal(`✗ ${e.message}`);
    } finally {
      occupe = false; majDynamique();
    }
  }
  function marquerFait() {
    const courant = compteDepuisChemin(location.pathname);
    if (courant) { etat.faits[courant] = "bloqué (manuel)"; sauver(); passerAuSuivant(courant); }
  }
  function passerCompte() {
    const courant = compteDepuisChemin(location.pathname);
    if (courant) { etat.exclus = [...new Set([...etat.exclus, courant])]; sauver(); passerAuSuivant(courant); }
  }

  // --- Mode automatique ---
  function arreterAuto(message) {
    auto.actif = false; autoAnnule = true; statutAuto = "";
    marquerOnglet(false); sauver();
    if (message) journal(message);
    rendre();
  }

  // Attente avec compte à rebours ; false si le mode a été arrêté entre-temps.
  async function attendreAuto(ms, libelle) {
    const fin = Date.now() + ms;
    while (Date.now() < fin) {
      if (!auto.actif || autoAnnule) return false;
      statutAuto = `${libelle} dans ${Math.ceil((fin - Date.now()) / 1000)} s`;
      majDynamique();
      await pause(Math.min(500, Math.max(0, fin - Date.now())));
    }
    return auto.actif && !autoAnnule;
  }

  async function ouvrirSuivantAuto(depuis) {
    const suivant = prochain(comptes, etat, depuis);
    if (!suivant) { arreterAuto("Terminé : tous les comptes sélectionnés sont traités."); return false; }
    if (auto.bloques >= auto.max) { arreterAuto(`Maximum atteint (${auto.max} blocages). Reprenez plus tard pour rester discret.`); return false; }
    ouvert = true; await sauver();
    location.assign(`/${suivant.compte}/`);
    return true;
  }

  // Une « tournée » par page : traite le profil affiché puis ouvre le suivant ; la page suivante reprend la boucle.
  async function boucleAuto() {
    if (enBoucle) return;
    enBoucle = true; autoAnnule = false;
    try {
      if (!auto.actif || !dansCetOnglet()) return;
      const courant = compteDepuisChemin(location.pathname);
      const cible = comptes.find((c) => c.compte === courant && aTraiter([c], etat).length);

      if (!cible) {                                           // pas sur un profil à traiter : ouvrir le prochain
        if (!(await attendreAuto(aleaMs(2, 5), "Ouverture du prochain profil"))) return;
        await ouvrirSuivantAuto(null);
        return;
      }
      if (auto.bloques >= auto.max) { arreterAuto(`Maximum atteint (${auto.max} blocages). Reprenez plus tard pour rester discret.`); return; }
      if (Date.now() < auto.prochainA && !(await attendreAuto(auto.prochainA - Date.now(), `Prochain blocage (@${cible.compte})`))) return;

      occupe = true; statutAuto = `Traitement de @${cible.compte}…`; majDynamique();
      let res;
      try { res = await traiterCourant(cible); }
      catch (e) { occupe = false; arreterAuto(`✗ ${e.message}`); return; }
      occupe = false;

      if (res === "bloque" || res === "bloque-non-verifie") {
        auto.bloques++;
        auto.prochainA = Date.now() + aleaMs(options.delaiMinS, options.delaiMaxS)
          + (auto.bloques % PAUSE_LONGUE.tousLes === 0 ? aleaMs(PAUSE_LONGUE.minS, PAUSE_LONGUE.maxS) : 0);
      } else {
        auto.prochainA = Math.max(auto.prochainA, Date.now() + aleaMs(2, 5));  // « déjà bloqué » / « introuvable » : courte pause
      }
      await sauver();
      await ouvrirSuivantAuto(cible.compte);
    } finally {
      enBoucle = false; occupe = false; majDynamique();
    }
  }

  // Fin de l'assistant : lance le mode choisi.
  async function demarrer() {
    if (!aTraiter(comptes, etat).length) { erreur = "Rien à bloquer : tous les comptes sont déjà traités."; return rendre(); }
    ouvert = true; ecran = "encours"; erreur = "";
    if (mode === "auto") {
      auto = { actif: true, bloques: 0, max: options.maxParSession, prochainA: 0 };
      marquerOnglet(true); await sauver(); rendre();
      journal("Mode automatique démarré.");
      boucleAuto();
    } else {
      await sauver(); rendre();
      const courant = compteDepuisChemin(location.pathname);
      if (!comptes.some((c) => c.compte === courant && aTraiter([c], etat).length)) passerAuSuivant(null);
    }
  }

  // --- Événements ---
  $("ouvrir").addEventListener("click", () => { ouvert = !ouvert; sauver(); rendre(); });
  $("menu").addEventListener("click", () => {
    const ferme = $("menuliste").hidden;
    $("menuliste").hidden = !ferme; $("menu").setAttribute("aria-expanded", String(ferme));
  });
  $("m-liste").addEventListener("click", () => { $("menuliste").hidden = true; if (auto.actif) arreterAuto(); allerA("liste"); });
  $("m-reset").addEventListener("click", () => {
    $("menuliste").hidden = true;
    if (!confirm("Effacer la progression et la sélection mémorisées par l'extension ? (Les blocages déjà faits sur Instagram restent.)")) return;
    if (auto.actif) arreterAuto();
    etat = { faits: {}, exclus: [], introuvables: {} }; dernier = 0; confirme = false;
    allerA(comptes.length ? "comptes" : "liste");
  });

  setInterval(majDynamique, 700);
  stockage.get(["etat", "liste", "dernier", "ouvert", "options", "auto", "ecran", "confirme", "mode"]).then((s) => {
    if (Array.isArray(s.liste)) comptes = s.liste;
    if (s.etat) etat = { faits: s.etat.faits || {}, exclus: s.etat.exclus || [], introuvables: s.etat.introuvables || {} };
    if (typeof s.dernier === "number") dernier = s.dernier;
    if (s.options) options = { ...OPTIONS_PAR_DEFAUT, preset: "perso", ...s.options };
    if (s.auto && s.auto.actif) auto = { actif: true, bloques: s.auto.bloques || 0, max: s.auto.max || options.maxParSession, prochainA: s.auto.prochainA || 0 };
    if (ECRANS.includes(s.ecran)) ecran = s.ecran;
    confirme = !!s.confirme; if (s.mode === "auto" || s.mode === "pas") mode = s.mode;
    ouvert = !!s.ouvert || (auto.actif && dansCetOnglet());
  }).catch(() => {}).then(() => {
    if (auto.actif) ecran = "encours";
    else if (!comptes.length) ecran = "liste";
    rendre();
    if (auto.actif && dansCetOnglet()) boucleAuto();
  });
})();
