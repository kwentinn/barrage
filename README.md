# Barrage pour Instagram

| Pièce | Rôle |
|---|---|
| `instagram_extreme_droite.ps1` | Génère la liste depuis Wikidata (CSV). |
| `liste-extreme-droite.json` | La liste (76 comptes), au format importable dans l'extension. |
| `index.html` / `verifier.html` | Site statique : liste de liens à bloquer à la main, et comparaison avec un export Instagram. |
| `extension/` | **Extension Firefox** : bloque les comptes d'une liste **importée**, depuis votre session instagram.com. |
| `docs/` | **Site de présentation** de l'extension (explications + téléchargement), prêt pour GitHub Pages. Ne contient aucune liste de comptes. |

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
2. Dans `extension/manifest.json`, remplacer l'identifiant (`browser_specific_settings.gecko.id`, actuellement
   `barrage@kwentinn.github.io`) par un identifiant unique à vous, de la forme `nom@domaine`, et incrémenter `version` à chaque
   nouvelle soumission. Un identifiant ne peut pas être réutilisé, même après la suppression du module sur AMO
   (erreur « Un identifiant identique a été trouvé »).
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

### Utiliser : l'assistant en 4 étapes
Ouvrir <https://www.instagram.com> connecté : bouton **Barrage** en bas à gauche. Le panneau guide, une chose à la fois :
1. **Votre liste** : coller des pseudos (un par ligne) ou choisir un fichier. Le panneau indique « N comptes reconnus ». La liste est
   mémorisée dans le navigateur.
2. **Qui bloquer ?** : liste à cocher avec recherche, *Tout cocher* / *Tout décocher*. Décochez les comptes à épargner.
3. **Avant de commencer** : résumé de ce qui va se passer, avertissement sur les conditions d'utilisation d'Instagram, et case
   **« J'ai compris »** obligatoire.
4. **Comment bloquer ?** : **Pas à pas** (recommandé) ou **Automatique**. Les réglages du mode automatique ne s'affichent qu'ici.

Puis un **écran de suivi** minimal, avec la progression. Le menu **⋯** de l'en-tête permet de *changer de liste* ou de *réinitialiser la
progression* ; les liens en bas de l'écran de suivi ramènent aux réglages ou à la sélection. Quand tout est traité, un écran de fin
résume : comptes bloqués, déjà bloqués, introuvables, épargnés.

#### Pas à pas
Un clic sur **Bloquer et passer au suivant** : l'extension clique pour vous sur ⋯ → Bloquer → Confirmer, puis ouvre le profil suivant.
8 s minimum entre deux blocages. **Déjà bloqué** (si vous avez bloqué le compte vous-même, ou si l'extension s'est arrêtée à la
confirmation) et **Passer** (ne pas bloquer ce compte) sont disponibles. Les profils **déjà bloqués** (bouton « Débloquer » sur la page, ou dans le menu) et les profils **inaccessibles** (compte supprimé ou banni,
bloqué par son titulaire, faute de frappe : « Cette page n’est malheureusement pas disponible ») sont reconnus dès l'arrivée sur la page
et sautés **sans attendre le délai** ; le bouton devient « Déjà bloqué : profil suivant » ou « Profil inaccessible : suivant ».
L'écran de fin liste les profils inaccessibles pour repérer une faute de frappe.

#### Automatique
L'extension enchaîne les profils sans intervention : pour chacun ⋯ → Bloquer → Confirmer, une pause, puis le suivant.
- **Trois préréglages** à l'étape 4, avec la durée estimée :
  | Préréglage | Maximum | Entre deux blocages | Durée estimée |
  |---|---|---|---|
  | Prudent (par défaut) | 10 | 40 à 90 s | environ 14 min |
  | Équilibré | 15 | 25 à 60 s | environ 15 min |
  | Rapide (« plus risqué ») | 25 | 15 à 35 s | environ 18 min |

  *Réglages avancés* : délais (15 s minimum) et maximum (de 1 à 30) libres. Une pause supplémentaire de 1 à 2 min s'ajoute tous les 5 blocages.
  Les profils « déjà bloqués » ou « inaccessibles » ne comptent pas dans le maximum, ne déclenchent pas le délai entre deux blocages (seulement une pause de 3 à 6 s avant le profil suivant) et n'arrêtent pas le mode.
- **Arrêt automatique** à la première erreur (bouton introuvable, confirmation à plusieurs choix, etc.), si Instagram affiche un message
  de limite (« Réessayez plus tard », « Nous limitons certaines activités »…), ou quand le maximum est atteint. Le motif est affiché.
- **Un seul onglet** : le mode ne tourne que dans l'onglet où vous l'avez lancé ; les autres onglets Instagram ne sont jamais détournés.
  Gardez l'onglet ouvert. Le bouton **Arrêter le mode automatique** est toujours disponible.
- C'est **plus risqué** que le pas à pas : un comportement régulier et sans intervention ressemble à un robot. Gardez de petites sessions
  et espacez-les. Si Instagram limite votre compte, arrêtez-vous plusieurs heures.

### Ce qu'il faut savoir
- Elle **n'appelle aucune API** : elle actionne l'interface web d'Instagram, avec votre session déjà ouverte. Pas de mot de passe,
  pas de serveur tiers. L'API interne `web_profile_info` renvoyait systématiquement HTTP 429 (essayée sur un vrai compte), d'où ce mode.
- Elle repère les boutons par leur libellé (« Options », « Bloquer », « Débloquer », en français et en anglais). Si Instagram
  change son interface, elle **s'arrête et indique l'étape** (avec les boutons vus) : utilisez alors *Déjà bloqué, suivant* après avoir
  bloqué à la main. Si la confirmation propose plusieurs choix (ex. « et d'autres comptes possibles »), elle s'arrête aussi plutôt
  que de choisir à votre place.
- Cela reste un usage automatisé de l'interface, hors du cadre strict des CGU d'Instagram ; le rythme d'un clic par profil (pas à pas)
  limite le risque de limitation temporaire des actions, sans l'éliminer, et le mode automatique l'augmente.
- **Le pas à pas fonctionne sur de vrais profils** (retour d'usage). **L'assistant et le mode automatique n'ont été testés que sur un
  faux profil** (`tests/fake-profile.html` : parcours des 4 étapes avec leurs validations, plafond de session, profil indisponible,
  message de limite, arrêt manuel, protection des autres onglets, écran de fin, menu ⋯), avec `node --test tests/` et `web-ext lint`.
  Pour un premier essai réel du mode automatique, réglez le **maximum à 2 ou 3** dans les réglages avancés.

### Développer
```bash
node --test tests/                # lecture de liste, suivi de progression (core.js)
cd extension && npx web-ext lint
cd extension && npx web-ext run   # lance Firefox avec l'extension
node serve.js                     # puis http://localhost:5173/alice/ : faux profil Instagram pour essayer le parcours sans Instagram
```

## Site de présentation (GitHub Pages)

`docs/index.html` est une page statique (aucune dépendance) qui présente l'extension, explique son fonctionnement et propose le téléchargement.
Le bouton pointe vers `docs/barrage.xpi` ; tant que ce fichier est absent, la page désactive le bouton et l'indique.

**Mettre en ligne**
1. Après chaque signature par Mozilla, copier le `.xpi` signé dans `docs/` sous le nom `barrage.xpi`, et mettre à jour la constante
   `VERSION` en bas de `docs/index.html`.
2. Sur GitHub : *Settings → Pages → Build and deployment* : source **Deploy from a branch**, branche `main`, dossier **/docs**.
3. Le site est servi à `https://<compte>.github.io/<dépôt>/`.

**À savoir**
- GitHub Pages n'est disponible que pour les dépôts **publics** avec un compte gratuit (les dépôts privés demandent une offre payante),
  et le site publié est public. Si ce dépôt reste privé, créer un petit dépôt public contenant seulement `docs/` (page + `barrage.xpi`).
- Rendre ce dépôt public publierait aussi `liste-extreme-droite.json`, le script Wikidata et les pages `index.html` / `verifier.html` à la racine.
- Selon le type MIME servi pour `.xpi`, Firefox propose l'installation directe ou télécharge simplement le fichier ; la page indique
  comment l'installer dans les deux cas.
- Les mises à jour de l'extension sont manuelles tant que le manifeste ne déclare pas d'`update_url` (un fichier `updates.json` hébergé sur le site).

## Avertissement sur la liste
Le classement vient de Wikidata (contributeurs bénévoles) : il est contesté, incomplet, et peut contenir des erreurs. Relisez-la avant de
la diffuser ou de l'utiliser.
