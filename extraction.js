// Extraction des comptes suivis depuis un export de données Instagram (following.json / following.html).
// Aucune dépendance au DOM : testable sous Node.

const HREF_RE = /instagram\.com\/(?:_u\/)?([A-Za-z0-9._]+)/i;

function depuisHref(href) {
  const m = typeof href === "string" && href.match(HREF_RE);
  return m ? m[1].toLowerCase() : null;
}

// Les exports récents mettent le pseudo dans "title", les anciens dans string_list_data[].value.
function extraireDepuisJson(texte) {
  const comptes = new Set();
  const visiter = (n) => {
    if (Array.isArray(n)) return n.forEach(visiter);
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n.string_list_data)) {
      if (typeof n.title === "string" && /^[A-Za-z0-9._]+$/.test(n.title)) comptes.add(n.title.toLowerCase());
      for (const e of n.string_list_data) {
        const u = depuisHref(e.href) || (typeof e.value === "string" && /^[A-Za-z0-9._]+$/.test(e.value) ? e.value.toLowerCase() : null);
        if (u) comptes.add(u);
      }
    }
    Object.values(n).forEach(visiter);
  };
  visiter(JSON.parse(texte));
  return comptes;
}

function extraireDepuisHtml(texte) {
  const comptes = new Set();
  for (const m of texte.matchAll(/href="([^"]*instagram\.com[^"]*)"/gi)) {
    const u = depuisHref(m[1]);
    if (u) comptes.add(u);
  }
  return comptes;
}

function extraire(nomFichier, texte) {
  return /\.json$/i.test(nomFichier) ? extraireDepuisJson(texte) : extraireDepuisHtml(texte);
}

// Seuls following.json / following.html comptent (pas followers, pas les demandes en attente...).
function estFichierAbonnements(chemin) {
  return /(^|\/)following\.(json|html)$/i.test(chemin);
}

if (typeof module !== "undefined") module.exports = { extraire, extraireDepuisJson, extraireDepuisHtml, estFichierAbonnements };
