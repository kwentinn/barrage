"use strict";
// Panneau injecté sur instagram.com : appelle l'API web interne d'Instagram avec la session déjà ouverte de l'utilisateur.
// Aucun mot de passe, aucun serveur tiers.

(() => {
  if (document.getElementById("blocage-ig-hote")) return;
  const { lancer, aTraiter, lireListe, OPTIONS_PAR_DEFAUT } = globalThis.BlocageCore;
  let comptes = []; // liste importée par l'utilisateur (aucune liste n'est fournie avec l'extension)
  const stockage = (typeof browser !== "undefined" ? browser : chrome).storage.local;

  // --- API interne d'Instagram (non documentée, peut changer sans préavis) ---
  const APP_ID = "936619743392459";
  const csrf = () => { const m = document.cookie.match(/(?:^|; )csrftoken=([^;]+)/); return m ? decodeURIComponent(m[1]) : null; };

  async function requete(chemin, init = {}) {
    const token = csrf();
    if (!token) throw new Error("Vous ne semblez pas connecté à Instagram.");
    const r = await fetch(chemin, {
      credentials: "include",
      ...init,
      headers: { "X-CSRFToken": token, "X-IG-App-ID": APP_ID, "X-Requested-With": "XMLHttpRequest", ...(init.headers || {}) },
    });
    return r;
  }
  async function json(r) {
    try { return await r.json(); } catch (e) { throw new Error(`Réponse inattendue d'Instagram (HTTP ${r.status}). Êtes-vous bien connecté ?`); }
  }

  const api = {
    async profil(compte) {
      const r = await requete(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(compte)}`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Instagram a refusé la recherche de @${compte} (HTTP ${r.status}). Limite atteinte ou session expirée ?`);
      const u = (await json(r)).data?.user;
      return u ? { id: u.id, bloqueParMoi: !!u.blocked_by_viewer } : null;
    },
    async bloquer(id) {
      const r = await requete(`/api/v1/web/friendships/${encodeURIComponent(id)}/block/`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "",
      });
      const j = await json(r);
      if (!r.ok || j.status !== "ok") throw new Error(`Instagram a refusé le blocage (HTTP ${r.status}${j.message ? " : " + j.message : ""}). Arrêt par précaution.`);
    },
  };

  // --- État persistant ---
  let etat = { faits: {}, exclus: [], introuvables: {} };
  let options = { ...OPTIONS_PAR_DEFAUT };
  let enCours = false, controleur = null;
  const sauver = () => stockage.set({ etat, options, liste: comptes }).catch(() => {});

  // --- Interface (Shadow DOM pour ne pas heurter les styles d'Instagram) ---
  const hote = document.createElement("div");
  hote.id = "blocage-ig-hote";
  const o = hote.attachShadow({ mode: "open" });
  o.innerHTML = `
<style>
  * { box-sizing: border-box; font: 14px/1.4 system-ui, sans-serif; }
  #ouvrir { position: fixed; left: 16px; bottom: 16px; z-index: 2147483647; background: #b4231a; color: #fff; border: 0; border-radius: 20px; padding: 8px 14px; cursor: pointer; font-weight: 600; box-shadow: 0 2px 8px #0005; }
  #panneau { position: fixed; left: 16px; bottom: 56px; z-index: 2147483647; width: 340px; max-height: 80vh; overflow: auto; background: #fff; color: #1c1917; border: 1px solid #d6d3d1; border-radius: 12px; padding: 14px; box-shadow: 0 4px 20px #0005; }
  h2 { margin: 0 0 6px; font-size: 16px; }
  small, .gris { color: #6b6560; font-size: 12px; }
  .bar { height: 6px; background: #e7e5e4; border-radius: 3px; margin: 6px 0 10px; overflow: hidden; } .bar div { height: 100%; width: 0; background: #166534; }
  .rang { display: flex; gap: 6px; align-items: center; margin: 6px 0; flex-wrap: wrap; }
  .rang label { display: flex; gap: 4px; align-items: center; } .rang input[type=number] { width: 56px; padding: 3px; }
  button { cursor: pointer; border: 1px solid #d6d3d1; background: #fff; border-radius: 8px; padding: 6px 10px; color: inherit; }
  button.go { background: #b4231a; border-color: #b4231a; color: #fff; font-weight: 600; } button:disabled { opacity: .5; cursor: default; }
  #journal { background: #f5f5f4; border-radius: 8px; padding: 6px 8px; margin: 8px 0; min-height: 36px; font-size: 12px; white-space: pre-wrap; }
  details { margin-top: 6px; } summary { cursor: pointer; }
  textarea { width: 100%; font: 12px/1.3 ui-monospace, monospace; padding: 6px; border: 1px solid #d6d3d1; border-radius: 8px; resize: vertical; }
  ul { list-style: none; margin: 6px 0 0; padding: 0; max-height: 220px; overflow: auto; } li { display: flex; gap: 6px; align-items: center; padding: 2px 0; font-size: 13px; } li .st { margin-left: auto; font-size: 12px; color: #166534; }
</style>
<button id="ouvrir" type="button">BulkBlock</button>
<section id="panneau" hidden>
  <h2>BulkBlock</h2>
  <div id="resume"></div><div class="bar"><div id="barre"></div></div>
  <div class="rang"><span>Délai entre deux blocages</span><label><input id="dmin" type="number" min="10" max="600"> à <input id="dmax" type="number" min="10" max="600"> s</label></div>
  <div class="rang"><label>Maximum par session <input id="maxs" type="number" min="1" max="30"></label></div>
  <div class="rang"><button id="go" class="go" type="button">Démarrer</button><button id="stop" type="button" hidden>Arrêter</button><button id="reset" type="button">Réinitialiser</button></div>
  <div id="journal" role="status" aria-live="polite"></div>
  <details id="import"><summary>Importer une liste</summary>
    <p class="gris">Un pseudo (ou lien instagram.com/pseudo) par ligne, ou un fichier JSON. Remplace la liste actuelle.</p>
    <div class="rang"><button id="choisir" type="button">Choisir un fichier…</button><input id="fichier" type="file" accept=".json,.txt,.csv,text/plain,application/json" hidden></div>
    <textarea id="coller" rows="4" placeholder="@pseudo&#10;https://www.instagram.com/pseudo/"></textarea>
    <div class="rang"><button id="importer" type="button">Importer le texte</button><button id="vider" type="button">Vider la liste</button></div>
  </details>
  <details><summary>Choisir les comptes (<span id="nbsel"></span>)</summary><ul id="liste"></ul></details>
  <small>Utilise l'interface interne d'Instagram, qui peut changer ou limiter ces actions. Espacez vos sessions ; l'extension s'arrête à la première erreur.</small>
</section>`;
  document.documentElement.append(hote);
  const $ = (id) => o.getElementById(id);

  const lignes = [];
  function journal(txt) { lignes.push(txt); if (lignes.length > 6) lignes.shift(); $("journal").textContent = lignes.join("\n"); }

  function rendre() {
    const exclus = new Set(etat.exclus);
    const actifs = comptes.filter((c) => !exclus.has(c.compte));
    const nFaits = actifs.filter((c) => etat.faits[c.compte]).length;
    $("resume").textContent = comptes.length
      ? `${nFaits} traités sur ${actifs.length} comptes sélectionnés`
      : "Aucune liste : importez-en une ci-dessous.";
    $("barre").style.width = actifs.length ? (100 * nFaits / actifs.length) + "%" : "0";
    $("nbsel").textContent = `${actifs.length}/${comptes.length}`;
    $("dmin").value = options.delaiMinS; $("dmax").value = options.delaiMaxS; $("maxs").value = options.maxParSession;
    $("go").hidden = enCours; $("go").disabled = !comptes.length; $("stop").hidden = !enCours; $("reset").disabled = enCours;
    for (const id of ["dmin", "dmax", "maxs", "choisir", "importer", "vider"]) $(id).disabled = enCours;
    $("import").open = $("import").open || !comptes.length;

    const ul = $("liste");
    ul.replaceChildren();
    for (const c of comptes) {
      const li = document.createElement("li");
      const cb = Object.assign(document.createElement("input"), { type: "checkbox", checked: !exclus.has(c.compte), disabled: enCours });
      cb.addEventListener("change", () => {
        const s = new Set(etat.exclus); cb.checked ? s.delete(c.compte) : s.add(c.compte);
        etat.exclus = [...s]; sauver(); rendre();
      });
      const nom = document.createElement("span"); nom.textContent = c.nom; nom.title = `@${c.compte} · ${c.classement}`;
      const st = document.createElement("span"); st.className = "st";
      st.textContent = etat.faits[c.compte] || (etat.introuvables[c.compte] ? "introuvable" : "");
      li.append(cb, nom, st);
      ul.append(li);
    }
  }

  function lireOptions() {
    const n = (id, min, max, def) => { const v = parseInt($(id).value, 10); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def; };
    options.delaiMinS = n("dmin", 10, 600, 30);
    options.delaiMaxS = Math.max(options.delaiMinS, n("dmax", 10, 600, 60));
    options.maxParSession = n("maxs", 1, 30, 10);
    sauver(); rendre();
  }
  for (const id of ["dmin", "dmax", "maxs"]) $(id).addEventListener("change", lireOptions);

  const MESSAGES_FIN = {
    termine: "Terminé : tous les comptes sélectionnés sont traités.",
    quota: "Maximum par session atteint. Reprenez plus tard pour rester discret.",
    arrete: "Arrêté.",
    erreur: "Arrêt sur erreur (voir ci-dessus). Réessayez plus tard.",
  };

  async function demarrer() {
    if (enCours) return;
    const restants = aTraiter(comptes, etat).length;
    if (!restants) { journal("Rien à faire : tous les comptes sélectionnés sont déjà traités."); return; }
    const n = Math.min(restants, options.maxParSession);
    if (!confirm(`Bloquer jusqu'à ${n} compte(s) depuis votre compte Instagram connecté ?\n\nVous pouvez arrêter à tout moment.`)) return;

    controleur = new AbortController(); enCours = true; rendre();
    const resume = await lancer({
      comptes, etat, api, options, signal: controleur.signal,
      surEvenement: (e) => {
        if (e.type === "debut") journal(`@${e.compte.compte}…`);
        else if (e.type === "bloque") journal(`✓ ${e.compte.nom} bloqué`);
        else if (e.type === "deja") journal(`= ${e.compte.nom} déjà bloqué`);
        else if (e.type === "introuvable") journal(`? @${e.compte.compte} introuvable (renommé ou supprimé)`);
        else if (e.type === "erreur") journal(`✗ ${e.message}`);
        else if (e.type === "etat") { sauver(); rendre(); }
      },
    });
    enCours = false; sauver(); rendre();
    journal(`${MESSAGES_FIN[resume.raison]} (${resume.bloques} bloqué(s), ${resume.dejaBloques} déjà bloqué(s))`);
  }

  function importer(texte) {
    const liste = lireListe(texte);
    if (!liste.length) { journal("Aucun compte reconnu dans ce contenu."); return; }
    if (!confirm(`Remplacer la liste actuelle par ${liste.length} compte(s) ?\n\nLa progression déjà enregistrée est conservée.`)) return;
    comptes = liste; sauver(); rendre();
    journal(`Liste importée : ${liste.length} compte(s). Vérifiez la sélection avant de démarrer.`);
  }
  $("choisir").addEventListener("click", () => $("fichier").click());
  $("fichier").addEventListener("change", async () => {
    const f = $("fichier").files[0]; $("fichier").value = "";
    if (f) importer(await f.text());
  });
  $("importer").addEventListener("click", () => { importer($("coller").value); $("coller").value = ""; });
  $("vider").addEventListener("click", () => {
    if (comptes.length && confirm("Vider la liste importée ?")) { comptes = []; sauver(); rendre(); }
  });

  $("ouvrir").addEventListener("click", () => { $("panneau").hidden = !$("panneau").hidden; });
  $("go").addEventListener("click", demarrer);
  $("stop").addEventListener("click", () => controleur && controleur.abort());
  $("reset").addEventListener("click", () => {
    if (confirm("Effacer la progression et la sélection mémorisées par l'extension ? (Les blocages déjà faits sur Instagram restent.)")) {
      etat = { faits: {}, exclus: [], introuvables: {} }; sauver(); rendre();
    }
  });

  stockage.get(["etat", "options", "liste"]).then((s) => {
    if (Array.isArray(s.liste)) comptes = s.liste;
    if (s.etat) etat = { faits: s.etat.faits || {}, exclus: s.etat.exclus || [], introuvables: s.etat.introuvables || {} };
    if (s.options) options = { ...options, ...s.options };
  }).catch(() => {}).then(rendre);
})();
