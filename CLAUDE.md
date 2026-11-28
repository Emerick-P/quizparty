# QuizParty : guide pour Claude

Quiz multijoueur temps réel sur le jeu vidéo, entre amis, dans le navigateur (mobile d'abord).
Client francophone : code, commentaires, textes et messages en français.

## Commandes
- `npm run dev` : serveur avec redémarrage auto (http://localhost:3000). `npm start` en prod.
- `npm test` : environ 3 min. Vérifie d'abord le plan du code, puis lance tous les tests bout-en-bout multi-clients.
  Pour relancer un seul test : `node test/<nom>-test.js`.
- `npm run codemap` : régénère `docs/CODEMAP.md` après avoir ajouté, renommé ou déplacé une fonction ou un fichier.
  Sans ça, `npm test` échoue.

## Trouver le code sans tout lire
1. Ouvre `docs/CODEMAP.md` : chaque fichier, son rôle et ses déclarations de premier niveau (clés de `actions` et `views` comprises).
2. Fais un `grep` du symbole, puis lis uniquement les lignes utiles avec un offset et une limite.
3. Ne lis jamais `server/data/*.js` en entier. Ce sont les banques de contenu (jusqu'à 125 Ko) : utilise `grep`.
   Pareil pour le `README.md` (24 Ko, doc côté humain).

## Architecture
- **Serveur** (`server/`, modules ES) : Express + Socket.IO, état des parties en mémoire sur une seule instance.
  `index.js` (HTTP, routes) → `rooms.js` (salons, événements socket) → `room.js` (moteur : phases, chrono, scores)
  → `games/<type>.js` (un module par type de manche, déclaré dans `KINDS`). Les modes sont dans `MODES` de `games/index.js`.
  Supabase (`store.js`, `auth.js`, `stats.js`, `daily.js`) est facultatif : sans variables d'env, tout reste en local.
  Notifications des directs (`push.js`, côté client `notify.js` et `sw.js`) : facultatives aussi (clés `VAPID_*`).
  Partage (`share.js`, dessin dans `share-card.js`) : aperçus de liens posés dans la page selon l'adresse, images
  `/partage/…` dessinées à la demande, scores portés par un jeton signé. Nom de l'app : `brand.js`, seul endroit à changer
  pour les images et les textes partagés (« LoreBound » ; le reste de l'app dit encore « QuizParty ») ; mascotte :
  `server/assets/mascotte.svg`. Jamais de score dans un défi entre potes.
- **Client** (`public/js/`) : une vingtaine de **scripts classiques, pas des modules**, chargés avec `defer` dans l'ordre d'`index.html`.
  Ils partagent leurs déclarations de premier niveau (`state`, `render`, `actions`…) sans import.
  - Un nouveau fichier s'ajoute dans `index.html`, à sa place dans l'ordre.
  - Au chargement, ne rien lancer d'asynchrone (fetch, socket, timer qui appelle `render`) : ça va dans `main.js`,
    qui s'exécute après tous les autres.
  - Un nom de premier niveau doit être unique dans tout `public/js`.
- **Boucle d'affichage** : le serveur envoie `state` → `session.js` le stocke → `render()` (`render.js`) appelle
  `views[displayPhase()]` (`views.js`) et applique le HTML au DOM par morph (pas de framework).
  Les boutons portent `data-action="x"`, géré par `actions.x` (`actions.js` et d'autres fichiers).
  Les chronos sont mis à jour à chaque frame depuis `data-until` (heure serveur).
- **Synchro, priorité absolue** : le serveur fait autorité. Les échéances sont en heures absolues (`startsAt`/`endsAt`),
  l'horloge client est calée façon NTP (`net.js`, `now()`), la latence est compensée côté serveur.
  Ne jamais chronométrer avec l'horloge locale.

## Recettes
- **Nouveau mode** (à partir des types existants) : une entrée dans `MODES` (`server/games/index.js`). Côté client, son groupe
  et son icône vont dans `MODE_GROUPS` / `MODE_ART` (`public/js/core.js`).
- **Nouveau type de manche** : `server/games/<type>.js` exporte `publicRound, validate, answerText, score, reveal`
  (modèle : `qcm.js`), à déclarer dans `KINDS`. Côté client : `KIND_LABEL` (`core.js`), puis l'affichage dans `views.question`
  et `views.reveal` (`views.js`). Ajouter un `test/<type>-test.js` et l'inscrire dans `npm test`.
- **Contenu** (questions, emojis, pitchs…) : `server/data/*.js`, uniquement des faits sûrs. `test/questions-test.js` vérifie le format.

## CSS (ordre de la cascade, chacun surcharge le précédent)
`style.css` (base) → `theme.css` (salon) → `plateau.css` (**tokens de couleur** `:root`, thème clair `[data-theme="light"]`)
→ `manette.css` (mode télé côté téléphone) → `salon.css` (accueil, salon, panneaux) ; `tv.css` en plus sur `/tv` ;
`proposer.css` pour `/proposer`.
Toute couleur passe par les variables de `plateau.css` (`--surf`, `--deep`, `--tile`, `--ink`, `--accent-text`…).
Habillage « Cartouche » : graphite et vert citron (`--lime`), réponses en touches A B C D aux couleurs `--c0`…`--c3`,
polices Space Grotesk (`--display`, `--body`) et JetBrains Mono (`--mono`). Icônes au trait avec `ico('nom')` (`ICONS` dans `core.js`),
jamais d'emoji dans l'interface (sauf le contenu du mode « Le jeu en emojis »). Pas d'italique, de biais, de dégradé ni de majuscules espacées.
Il reste des couleurs en dur, surtout dans `style.css` et `plateau.css` : à remplacer par des tokens pendant la refonte du design.
Toujours vérifier les deux thèmes (Clair / Obscur), en portrait et en paysage sur téléphone, sans défilement.

## Prod et dev (deux bases Supabase)
- **Prod** = projet Supabase `quizparty` (`kmdcsvcvmgpleeqlpnmm`), utilisé seulement par Render.
  **Dev** = `quizparty-dev` (`uqjsjdapaernkqzcqupm`) : le `.env` local et `npm run share` pointent dessus.
- `server/env.js` refuse de démarrer hors Render sur la base de prod. Scripts de maintenance sur la prod :
  `--prod`, qui lit `.env.prod` (ex. `npm run submissions -- --prod`). `npm test` reste sans Supabase.
- Données fictives du dev : `supabase/seed.sql` (rejouable). Le dev se met en pause après 7 jours sans activité :
  le réactiver depuis le tableau de bord Supabase (ou le connecteur).
- Changement de schéma : un fichier `supabase/migrations/AAAA-MM-JJ-nom.sql` + la même chose dans `schema.sql`.
  On l'applique **d'abord au dev**, on teste, puis à la prod seulement avec l'accord écrit du client.
- Le compte gratuit n'a droit qu'à 2 projets actifs : `gamerdex-prod` est en pause pour laisser la place au dev.
- **Anti-veille de Render — À SUPPRIMER si le serveur Render passe en payant** : la base de **prod** (pg_cron + pg_net,
  migration `2026-11-28-reveil-render.sql`) appelle `/health` toutes les 10 min. Retrait :
  `select cron.unschedule('quizparty-reveil');`, et `live-wake.yml` devient inutile aussi. Jamais sur le dev (hors essai),
  ni dans `schema.sql`. Quota gratuit : 750 h/mois pour tout l'espace Render, donc **un seul** service gratuit.

## Règles du projet
- `main` = la prod : chaque push redéploie Render et coupe les parties en cours. On travaille sur une branche `feature/…`.
  On ne merge et on ne pousse sur `main` qu'avec l'accord du client (seule exception : la tâche nocturne des propositions).
- La base de travail du client est `D:\Dev\quizparty\quizparty`. Relire son fichier avant de le modifier : il a pu le changer.
- Aucun secret dans le code : variables d'env, documentées dans `.env.example`.
- **Contenus réservés** (droits non acquis : sons) : modes marqués `reserved: true`
  dans `MODES` (`RESERVED_MODES`). Visibles seulement si l'hôte a le rôle `friend` ou `admin` (`profiles.role`) : filtrés
  par `allowed()` dans la liste, le Mix et les réglages, absents du Défi du jour. Fichiers `/sfx` jamais
  en accès direct : seulement ceux de la partie d'un salon, avec sa clé (`Room.protectMedia`). Tout nouveau contenu
  aux droits douteux suit ce chemin. Plus de code d'accès au site (`ACCESS_CODE` supprimé).
- Aucun changement visible pour le joueur sans accord du client. Les choix techniques reviennent à Claude.
- Sons, images et données tierces : respecter les conditions des API et signaler ce qui gênerait une mise en ligne publique.

## Sous-agents et modèle par tâche
Le fil principal garde le travail qui demande du jugement : architecture, synchro, `room.js`, sécurité, décisions produit.
Un sous-agent part de zéro : il ne rapporte que s'il évite de lire beaucoup de fichiers ou une longue sortie.
Pour une tâche ciblée (1 à 3 fichiers connus grâce à CODEMAP), on la fait directement.

| Agent (`.claude/agents/`) | Modèle | Quand l'utiliser |
|---|---|---|
| `explorer` | Haiku | Recherche large en lecture seule (« où est géré X ? », plus de 5 fichiers à parcourir). Il rend des chemins et des lignes, pas du code. |
| `testeur` | Haiku | Lancer `npm test` ou un test, puis résumer uniquement les échecs (sortie de 3 min). |
| `contenu` | Sonnet | Ajouter ou corriger du contenu dans `server/data` (faits vérifiés), traiter des propositions. |
| `ui` | Sonnet | Retouches CSS ou de vue bien délimitées, avec captures Playwright dans les deux thèmes. |
| *(fil principal)* | Opus | Synchro, moteur de partie, nouveau type de manche, refactor, revue finale avant merge. |

Le fil principal relit le diff d'un sous-agent avant tout commit.
