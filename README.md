# Barrage pour Instagram

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

### Utiliser (mode pas à pas)
1. Ouvrir <https://www.instagram.com> connecté : bouton **Barrage** en bas à gauche.
2. **Importer une liste** (fichier ou texte collé). Elle est mémorisée dans le navigateur.
3. **Choisir les comptes** : décocher ceux à ne pas bloquer.
4. **Ouvrir le prochain profil**, puis **Bloquer et passer au suivant** : l'extension clique pour vous sur ⋯ → Bloquer → Confirmer,
   puis ouvre le profil suivant. Un clic par profil, 8 s minimum entre deux blocages.
   - **Déjà bloqué, suivant** : si vous avez bloqué le compte vous-même (ou si l'extension s'est arrêtée à la confirmation).
   - **Passer** : ne pas bloquer ce compte.
   - Les comptes déjà bloqués sont reconnus (menu « Débloquer »), les profils indisponibles sont marqués « introuvable ».
5. La progression est mémorisée : reprenez quand vous voulez.

### Ce qu'il faut savoir
- Elle **n'appelle aucune API** : elle actionne l'interface web d'Instagram, avec votre session déjà ouverte. Pas de mot de passe,
  pas de serveur tiers. L'API interne `web_profile_info` renvoyait systématiquement HTTP 429 (essayée sur un vrai compte), d'où ce mode.
- Elle repère les boutons par leur libellé (« Options », « Bloquer », « Débloquer », en français et en anglais). Si Instagram
  change son interface, elle **s'arrête et indique l'étape** (avec les boutons vus) : utilisez alors *Déjà bloqué, suivant* après avoir
  bloqué à la main. Si la confirmation propose plusieurs choix (ex. « et d'autres comptes possibles »), elle s'arrête aussi plutôt
  que de choisir à votre place.
- Cela reste un usage automatisé de l'interface, hors du cadre strict des CGU d'Instagram ; le rythme d'un clic par profil limite le risque
  de limitation temporaire des actions, sans l'éliminer.
- **Pas encore essayée sur de vrais profils.** Testé : la logique (`node --test tests/`), le parcours complet sur un faux profil
  (`tests/fake-profile.html` : blocage, déjà bloqué, page indisponible, confirmation à plusieurs choix) et `web-ext lint`.
  Faites un premier essai avec **un seul compte**.

### Développer
```bash
node --test tests/                # lecture de liste, suivi de progression (core.js)
cd extension && npx web-ext lint
cd extension && npx web-ext run   # lance Firefox avec l'extension
node serve.js                     # puis http://localhost:5173/alice/ : faux profil Instagram pour essayer le parcours sans Instagram
```

## Avertissement sur la liste
Le classement vient de Wikidata (contributeurs bénévoles) : il est contesté, incomplet, et peut contenir des erreurs. Relisez-la avant de
la diffuser ou de l'utiliser.
