# BulkBlock

| Pièce | Rôle |
|---|---|
| `instagram_extreme_droite.ps1` | Génère la liste depuis Wikidata (CSV). |
| `liste-extreme-droite.json` | La liste (76 comptes), au format importable dans l'extension. |
| `index.html` / `verifier.html` | Site statique : liste de liens à bloquer à la main, et comparaison avec un export Instagram. |
| `extension/` | **Extension Firefox** : bloque les comptes d'une liste **importée**, depuis votre session instagram.com. |

## Extension Firefox

L'extension est un outil générique : **elle ne contient aucune liste**. On lui importe un fichier ou du texte.

### Format de liste accepté
- Texte : un pseudo (`@pseudo` ou `pseudo`) ou un lien `instagram.com/pseudo` par ligne ; les lignes d'un CSV contenant un lien conviennent.
- JSON : `["pseudo", ...]`, `[{"compte": "pseudo", "nom": "Nom", "classement": "…"}, ...]` ou `{"comptes": [...]}`.

### Installer
**Pour tester (temporaire)** : Firefox → `about:debugging#/runtime/this-firefox` → *Charger un module complémentaire temporaire…* → `extension/manifest.json`.
L'extension disparaît au redémarrage de Firefox.

**Durablement, en la faisant signer par Mozilla (gratuit)** :
1. Créer un compte sur <https://addons.mozilla.org/developers/> et générer des clés API (*Tools → Manage API Keys*).
2. Dans `extension/manifest.json`, remplacer l'identifiant `bulkblock@local` par un identifiant unique à vous
   (ex. `bulkblock@votre-domaine.fr`) et incrémenter `version` à chaque nouvelle soumission.
3. ```bash
   cd extension
   npx web-ext sign --channel=unlisted --api-key=<JWT issuer> --api-secret=<JWT secret>
   ```
   Mozilla valide automatiquement et renvoie un `.xpi` signé (`web-ext-artifacts/`), installable dans Firefox standard
   (glisser-déposer sur la fenêtre, ou *Installer un module depuis un fichier*). Le `.xpi` peut être distribué tel quel ;
   les mises à jour sont manuelles, sauf à héberger un `update_url`.
4. Publier sur addons.mozilla.org (listé) est aussi possible mais passe par une relecture humaine, plus aléatoire pour un outil qui
   s'appuie sur l'API interne d'Instagram. Firefox Developer Edition / Nightly acceptent aussi les extensions non signées
   (`xpinstall.signatures.required` = false).

### Utiliser
1. Ouvrir <https://www.instagram.com> connecté : bouton **BulkBlock** en bas à gauche.
2. **Importer une liste** (fichier ou texte collé). Elle est mémorisée dans le navigateur.
3. **Choisir les comptes** : décocher ceux à ne pas bloquer.
4. Régler le délai (min. 10 s, 30–60 s par défaut) et le maximum par session (10 par défaut), puis **Démarrer**.
   Pour chaque compte : recherche du profil, saut des comptes déjà bloqués ou introuvables, pause de quelques secondes, blocage, puis délai.
   **Arrêter** interrompt avant le prochain blocage. La progression est mémorisée : relancez plus tard pour les comptes restants.

### Ce qu'il faut savoir
- Elle utilise l'**API web interne d'Instagram** (non documentée), avec votre session déjà ouverte : pas de mot de passe, pas de serveur tiers.
  Ce n'est pas l'API officielle (qui n'offre pas de blocage) et cela sort du cadre des CGU d'Instagram.
- Instagram peut changer ces appels sans préavis, ou limiter les actions répétées (blocage temporaire des actions). L'extension
  **s'arrête à la première erreur** au lieu d'insister ; espacez les sessions.
- **Non testée sur un vrai compte Instagram.** Testé : la logique (`node --test tests/`, fausse API), le panneau et l'import dans une page
  locale simulée (`tests/harness.html`), et `web-ext lint`. Non vérifiés : les appels réels `/api/v1/users/web_profile_info/` et
  `/api/v1/web/friendships/{id}/block/`. Faites un premier essai avec **un seul compte** (maximum par session = 1).

### Développer
```bash
node --test tests/                # logique de blocage et lecture de liste (core.js)
cd extension && npx web-ext lint
cd extension && npx web-ext run   # lance Firefox avec l'extension
node serve.js                     # puis http://localhost:5173/tests/harness.html : panneau sans Instagram
```

## Avertissement sur la liste
Le classement vient de Wikidata (contributeurs bénévoles) : il est contesté, incomplet, et peut contenir des erreurs. Relisez-la avant de
la diffuser ou de l'utiliser.
