"use strict";
// Mode pas à pas : sur le profil d'un compte de la liste, un clic exécute les gestes habituels de l'interface
// (⋯ → Bloquer → Confirmer), puis ouvre le profil suivant. Aucun appel d'API : c'est l'interface web d'Instagram qui travaille,
// avec votre session déjà ouverte. Pas de mot de passe, pas de serveur tiers.

(() => {
  if (document.getElementById("blocage-ig-hote")) return;
  const { aTraiter, lireListe, compteDepuisChemin, prochain } = globalThis.BlocageCore;
  const stockage = (typeof browser !== "undefined" ? browser : chrome).storage.local;
  const DELAI_ENTRE_BLOCAGES_S = 8;

  // --- État persistant ---
  let comptes = [];
  let etat = { faits: {}, exclus: [], introuvables: {} };
  let dernier = 0;      // horodatage du dernier blocage (délai minimal entre deux blocages)
  let ouvert = false;   // panneau ouvert (mémorisé d'une page à l'autre)
  let occupe = false;
  const sauver = () => stockage.set({ etat, liste: comptes, dernier, ouvert }).catch(() => {});

  // --- Gestes sur l'interface d'Instagram ---
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const visible = (el) => el.getClientRects().length > 0;
  const RE_BLOQUER = /^(bloquer|block)$/i;
  const RE_DEBLOQUER = /^(débloquer|debloquer|unblock)$/i;

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

  // Retourne "bloque" | "deja" | "introuvable", ou lève une erreur décrivant l'étape qui a échoué.
  async function executerBlocage() {
    // 1. Bouton « ⋯ » (aria-label « Options ») dans l'en-tête du profil
    const options = await attendreQue(() => {
      const svg = document.querySelector('header svg[aria-label="Options"]') || document.querySelector('svg[aria-label="Options"]');
      return svg && (svg.closest('[role="button"], button') || svg.parentElement);
    });
    if (!options) {
      if (/n.est pas disponible|isn.t available|not available|introuvable/i.test(document.body.innerText)) return "introuvable";
      throw new Error("Bouton « ⋯ » (Options) introuvable sur ce profil. L'interface d'Instagram a peut-être changé.");
    }
    options.click();

    // 2. Menu : « Bloquer » (ou « Débloquer » si déjà fait)
    const menu = await attendreQue(dernierDialogue);
    if (!menu) throw new Error("Le menu du profil ne s'est pas ouvert.");
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
  * { box-sizing: border-box; font: 14px/1.4 system-ui, sans-serif; }
  #ouvrir { position: fixed; left: 16px; bottom: 16px; z-index: 2147483647; background: #b4231a; color: #fff; border: 0; border-radius: 20px; padding: 8px 14px; cursor: pointer; font-weight: 600; box-shadow: 0 2px 8px #0005; }
  #panneau { position: fixed; left: 16px; bottom: 56px; z-index: 2147483647; width: 340px; max-height: 80vh; overflow: auto; background: #fff; color: #1c1917; border: 1px solid #d6d3d1; border-radius: 12px; padding: 14px; box-shadow: 0 4px 20px #0005; }
  h2 { margin: 0 0 6px; font-size: 16px; }
  small, .gris { color: #6b6560; font-size: 12px; }
  .bar { height: 6px; background: #e7e5e4; border-radius: 3px; margin: 6px 0 10px; overflow: hidden; } .bar div { height: 100%; width: 0; background: #166534; }
  .rang { display: flex; gap: 6px; align-items: center; margin: 6px 0; flex-wrap: wrap; }
  #cible { font-weight: 600; margin: 4px 0; }
  button { cursor: pointer; border: 1px solid #d6d3d1; background: #fff; border-radius: 8px; padding: 6px 10px; color: inherit; }
  button.go { background: #b4231a; border-color: #b4231a; color: #fff; font-weight: 600; } button:disabled { opacity: .5; cursor: default; } [hidden] { display: none !important; }
  #journal { background: #f5f5f4; border-radius: 8px; padding: 6px 8px; margin: 8px 0; min-height: 36px; font-size: 12px; white-space: pre-wrap; }
  details { margin-top: 6px; } summary { cursor: pointer; }
  textarea { width: 100%; font: 12px/1.3 ui-monospace, monospace; padding: 6px; border: 1px solid #d6d3d1; border-radius: 8px; resize: vertical; }
  ul { list-style: none; margin: 6px 0 0; padding: 0; max-height: 220px; overflow: auto; } li { display: flex; gap: 6px; align-items: center; padding: 2px 0; font-size: 13px; } li .st { margin-left: auto; font-size: 12px; color: #166534; }
</style>
<button id="ouvrir" type="button">BulkBlock</button>
<section id="panneau" hidden>
  <h2>BulkBlock</h2>
  <div id="resume"></div><div class="bar"><div id="barre"></div></div>
  <div id="cible"></div>
  <div class="rang"><button id="bloquer" class="go" type="button">Bloquer et passer au suivant</button><button id="aller" class="go" type="button">Ouvrir le prochain profil</button></div>
  <div class="rang"><button id="fait" type="button" title="Si vous avez bloqué ce compte vous-même">Déjà bloqué, suivant</button><button id="passer" type="button" title="Ne pas bloquer ce compte">Passer</button></div>
  <div id="journal" role="status" aria-live="polite"></div>
  <details id="import"><summary>Importer une liste</summary>
    <p class="gris">Un pseudo (ou lien instagram.com/pseudo) par ligne, ou un fichier JSON. Remplace la liste actuelle.</p>
    <div class="rang"><button id="choisir" type="button">Choisir un fichier…</button><input id="fichier" type="file" accept=".json,.txt,.csv,text/plain,application/json" hidden></div>
    <textarea id="coller" rows="4" placeholder="@pseudo&#10;https://www.instagram.com/pseudo/"></textarea>
    <div class="rang"><button id="importer" type="button">Importer le texte</button><button id="vider" type="button">Vider la liste</button></div>
  </details>
  <details><summary>Choisir les comptes (<span id="nbsel"></span>)</summary><ul id="liste"></ul></details>
  <div class="rang"><button id="reset" type="button">Réinitialiser la progression</button></div>
  <small>Un clic = un blocage, comme à la main, avec <span id="delai"></span> s minimum entre deux. L'interface d'Instagram peut changer ; en cas d'échec l'extension s'arrête et vous indique l'étape.</small>
</section>`;
  document.documentElement.append(hote);
  const $ = (id) => o.getElementById(id);
  $("delai").textContent = DELAI_ENTRE_BLOCAGES_S;

  const lignes = [];
  function journal(txt) { lignes.push(txt); if (lignes.length > 6) lignes.shift(); $("journal").textContent = lignes.join("\n"); }

  // Partie légère, rappelée régulièrement (la navigation d'Instagram ne recharge pas toujours la page).
  function majCible() {
    const courant = compteDepuisChemin(location.pathname);
    const cible = comptes.find((c) => c.compte === courant && aTraiter([c], etat).length) || null;
    const suivant = prochain(comptes, etat, cible && cible.compte);
    const restant = Math.max(0, Math.ceil((dernier + DELAI_ENTRE_BLOCAGES_S * 1000 - Date.now()) / 1000));

    $("cible").textContent = !comptes.length ? "" : cible ? `Profil ouvert : ${cible.nom} (@${cible.compte})`
      : suivant ? `Prochain : ${suivant.nom} (@${suivant.compte})` : "Tous les comptes sont traités.";
    $("bloquer").hidden = !cible;
    $("bloquer").disabled = occupe || restant > 0;
    $("bloquer").textContent = occupe ? "En cours…" : restant > 0 ? `Patientez ${restant} s…` : "Bloquer et passer au suivant";
    $("aller").hidden = !!cible || !suivant;
    $("aller").disabled = occupe;
    $("fait").hidden = !cible; $("fait").disabled = occupe;
    $("passer").hidden = !cible; $("passer").disabled = occupe;
  }

  function rendre() {
    const exclus = new Set(etat.exclus);
    const actifs = comptes.filter((c) => !exclus.has(c.compte));
    const nFaits = actifs.filter((c) => etat.faits[c.compte]).length;
    $("resume").textContent = comptes.length
      ? `${nFaits} traités sur ${actifs.length} comptes sélectionnés`
      : "Aucune liste : importez-en une ci-dessous.";
    $("barre").style.width = actifs.length ? (100 * nFaits / actifs.length) + "%" : "0";
    $("nbsel").textContent = `${actifs.length}/${comptes.length}`;
    $("import").open = $("import").open || !comptes.length;
    $("panneau").hidden = !ouvert;
    for (const id of ["choisir", "importer", "vider", "reset"]) $(id).disabled = occupe;

    const ul = $("liste");
    ul.replaceChildren();
    for (const c of comptes) {
      const li = document.createElement("li");
      const cb = Object.assign(document.createElement("input"), { type: "checkbox", checked: !exclus.has(c.compte), disabled: occupe });
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
    majCible();
  }

  async function passerAuSuivant(compte) {
    const suivant = prochain(comptes, etat, compte);
    if (!suivant) { journal("Terminé : tous les comptes sélectionnés sont traités."); return; }
    ouvert = true;
    await sauver();
    location.assign(`/${suivant.compte}/`);
  }

  async function bloquerCourant() {
    const courant = compteDepuisChemin(location.pathname);
    const cible = comptes.find((c) => c.compte === courant && aTraiter([c], etat).length);
    if (!cible || occupe) return;
    occupe = true; majCible();
    journal(`@${cible.compte}…`);
    try {
      const res = await executerBlocage();
      if (res === "introuvable") { etat.introuvables[cible.compte] = true; journal(`? @${cible.compte} introuvable (renommé ou supprimé)`); }
      else if (res === "deja") { etat.faits[cible.compte] = "déjà bloqué"; journal(`= ${cible.nom} déjà bloqué`); }
      else {
        etat.faits[cible.compte] = "bloqué"; dernier = Date.now();
        journal(res === "bloque" ? `✓ ${cible.nom} bloqué` : `✓ ${cible.nom} : blocage envoyé, non vérifié (vérifiez le profil)`);
      }
      await sauver(); rendre();
      await passerAuSuivant(cible.compte);
    } catch (e) {
      journal(`✗ ${e.message}`);
    } finally {
      occupe = false; majCible();
    }
  }

  function importer(texte) {
    const liste = lireListe(texte);
    if (!liste.length) { journal("Aucun compte reconnu dans ce contenu."); return; }
    if (!confirm(`Remplacer la liste actuelle par ${liste.length} compte(s) ?\n\nLa progression déjà enregistrée est conservée.`)) return;
    comptes = liste; sauver(); rendre();
    journal(`Liste importée : ${liste.length} compte(s). Vérifiez la sélection avant de démarrer.`);
  }

  $("ouvrir").addEventListener("click", () => { ouvert = !ouvert; sauver(); rendre(); });
  $("bloquer").addEventListener("click", bloquerCourant);
  $("aller").addEventListener("click", () => passerAuSuivant(null));
  $("fait").addEventListener("click", () => {
    const courant = compteDepuisChemin(location.pathname);
    if (courant) { etat.faits[courant] = "bloqué (manuel)"; sauver(); rendre(); passerAuSuivant(courant); }
  });
  $("passer").addEventListener("click", () => {
    const courant = compteDepuisChemin(location.pathname);
    if (courant) { etat.exclus = [...new Set([...etat.exclus, courant])]; sauver(); rendre(); passerAuSuivant(courant); }
  });
  $("choisir").addEventListener("click", () => $("fichier").click());
  $("fichier").addEventListener("change", async () => {
    const f = $("fichier").files[0]; $("fichier").value = "";
    if (f) importer(await f.text());
  });
  $("importer").addEventListener("click", () => { importer($("coller").value); $("coller").value = ""; });
  $("vider").addEventListener("click", () => {
    if (comptes.length && confirm("Vider la liste importée ?")) { comptes = []; sauver(); rendre(); }
  });
  $("reset").addEventListener("click", () => {
    if (confirm("Effacer la progression et la sélection mémorisées par l'extension ? (Les blocages déjà faits sur Instagram restent.)")) {
      etat = { faits: {}, exclus: [], introuvables: {} }; dernier = 0; sauver(); rendre();
    }
  });

  setInterval(majCible, 700);
  stockage.get(["etat", "liste", "dernier", "ouvert"]).then((s) => {
    if (Array.isArray(s.liste)) comptes = s.liste;
    if (s.etat) etat = { faits: s.etat.faits || {}, exclus: s.etat.exclus || [], introuvables: s.etat.introuvables || {} };
    if (typeof s.dernier === "number") dernier = s.dernier;
    ouvert = !!s.ouvert;
  }).catch(() => {}).then(rendre);
})();
