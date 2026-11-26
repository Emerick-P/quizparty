# QuizParty

Quiz multijoueur en temps réel entre amis. Chacun joue depuis son téléphone ou son ordinateur, dans le navigateur.

- Salons à code de 4 lettres, avec un lien à partager
- 9 modes : Quiz classique (4 choix ou réponse tapée), Vrai ou faux, Estimation, Jaquette pixelisée, Pitch mal expliqué, Le jeu en emojis, Quel jeu fait ce bruit ?, Mots croisés, Mix
- Jaquette, Pitch, Emojis et Sons : l'hôte choisit le format de réponse dans le salon (« 4 choix » ou « Réponse tapée »)
- Réglages de l'hôte : nombre de questions (5 à 20), temps par question (10 à 30 s)
- Classement après chaque question, podium à la fin
- Score global du salon : cumul des parties terminées et nombre de victoires, affiché dans le salon et à la fin de chaque partie ; l'hôte peut le remettre à zéro
- Reconnexion automatique : un joueur qui recharge la page ou perd le réseau retrouve sa place et son score

## Lancer en local

Il faut Node.js 18 ou plus.

```bash
npm install
npm start
```

Ouvre ensuite http://localhost:3000. Pour tester à plusieurs sur le même Wi-Fi, les autres ouvrent `http://<IP-de-ton-PC>:3000`.

Pour développer : `npm run dev` relance le serveur à chaque modification d'un fichier de `server/` (pour `public/`, un simple rafraîchissement du navigateur suffit).

Pour lancer les tests automatiques (parties complètes avec joueurs simulés, et un faux IGDB pour les jaquettes) : `npm test`.

### Jaquettes (IGDB)

Les modes « Jaquette » utilisent l'API IGDB de Twitch :
1. Crée une application sur https://dev.twitch.tv/console/apps (catégorie « Application Integration », URL de redirection `http://localhost`).
2. Copie `.env.example` en `.env` et remplis `TWITCH_CLIENT_ID` et `TWITCH_CLIENT_SECRET` (ou définis ces variables d'environnement).
3. Lance `npm run covers` : télécharge les jaquettes dans `.cache/images/` et liste les jeux introuvables.

Au démarrage, le serveur complète le cache en arrière-plan. Les jaquettes déjà en cache restent utilisables sans connexion ni identifiants. Sans aucune jaquette, les modes sont grisés dans le salon avec la raison.

- Liste des jeux : `server/data/cover-games.js` (slug IGDB, titre, année, réponses alternatives).
- Retirer un jeu : bouton « Retirer ce jeu des prochaines parties » (hôte, pendant la correction), ou ajout de son slug dans `data/blacklist.json`.
- Mentions : « Image : IGDB » pendant la question, éditeur et lien vers la fiche IGDB à la correction, mention générale sur l'accueil.

## Comment la synchronisation est garantie

1. **Le serveur est la seule source de vérité.** Il décide des phases, du chrono, de qui a répondu et des scores. Les navigateurs ne font qu'afficher l'état reçu et envoyer des actions.
2. **Les échéances sont des heures absolues.** Pour chaque question, le serveur envoie `startsAt` (affichage de la question) et `endsAt` (fin du chrono). Il n'envoie pas de décompte seconde par seconde.
3. **Synchronisation d'horloge.** À la connexion, puis toutes les 15 s, chaque navigateur mesure son décalage avec l'horloge du serveur, sur le principe de NTP. Il garde la mesure au plus petit aller-retour. La question s'affiche donc au même instant sur tous les écrans, quelle que soit la latence de chacun.
4. **Compensation de latence.** Le serveur mesure le ping de chaque joueur toutes les 5 s. Il retire la moitié de ce ping (250 ms maximum) au moment de réception d'une réponse. Un joueur en 4G n'est ainsi pas pénalisé face à un joueur en fibre.
5. **Fin anticipée.** Dès que tous les joueurs connectés ont répondu, on passe à la correction.

Limite assumée : la question est envoyée pendant le « 3, 2, 1 » pour s'afficher en même temps partout. Quelqu'un qui fouille dans les outils développeur du navigateur peut donc la lire 3 secondes à l'avance (pas la réponse, qui reste sur le serveur). Entre amis, c'est acceptable.

## Mettre en ligne

L'état des parties est gardé en mémoire : il faut **une seule instance** du serveur, qui tourne en continu. Un hébergement statique (GitHub Pages, Netlify) ne suffit pas.

**Site permanent : Render (choix actuel)**

Le fichier `render.yaml` décrit le service : Render → **New → Blueprint** → choisir le dépôt GitHub, puis remplir `TWITCH_CLIENT_ID` et `TWITCH_CLIENT_SECRET`. Chaque `git push` sur la branche principale redéploie le site (ce qui coupe les parties en cours).

- Formule gratuite (512 Mo) : le serveur s'endort après 15 minutes sans visite ni message temps réel ; le premier visiteur voit la page d'attente de Render environ une minute. 750 heures gratuites par mois, assez pour un service allumé en continu.
- Disque non conservé : à chaque réveil, les jaquettes sont retéléchargées depuis IGDB (les modes Jaquette sont grisés quelques instants) et `data/feedback.jsonl` repart de zéro.
- Pour supprimer la mise en veille : passer le service en formule payante (Compute → Edit, ou `plan: starter` dans `render.yaml`), sans rien changer d'autre.

**Autre option : VM Oracle Cloud « Always Free » (gratuit, mais VM souvent en rupture)**

Ubuntu + Node + Caddy (HTTPS automatique, WebSocket compris). Node n'écoute que sur la machine (`HOST=127.0.0.1`), Caddy est la seule porte d'entrée.

1. Sur la VM, cloner le dépôt GitHub (privé, clé de déploiement en lecture seule) dans `~/quizparty`.
2. `sudo bash deploy/install.sh [domaine]` : installe Node 22 et Caddy, ouvre les ports 80/443 dans le pare-feu de la VM, demande les clés Twitch pour créer `.env`, crée le service `quizparty` (démarrage auto, redémarrage en cas de plantage). Sans domaine, le site répond sur `https://<ip-avec-tirets>.sslip.io`. Le script peut être relancé (par exemple avec le vrai domaine).
3. Mise à jour après un `git push` : `bash ~/quizparty/deploy/update.sh` (coupe les parties en cours).
4. Côté Oracle, la « Security List » du réseau doit aussi autoriser les ports 80 et 443 en entrée.

Commandes utiles sur la VM : `sudo journalctl -u quizparty -f` (logs du jeu), `sudo journalctl -u caddy -n 50` (HTTPS), `sudo systemctl restart quizparty`.

**Contenus réservés** (sons, droits non acquis) : le site est ouvert à tous, mais ce mode n'apparaît que dans les salons dont l'hôte a un compte au rôle `friend` ou `admin` (table `profiles`, colonne `role`, dans Supabase). Leurs fichiers ne sont jamais servis en accès direct : seulement ceux de la partie en cours d'un salon, avec la clé de ce salon.

**Depuis ton PC, en une commande (tunnel Cloudflare)**
1. Une seule fois : `winget install --id Cloudflare.cloudflared` (gratuit, sans compte).
2. `npm run share` : lance le serveur (ou réutilise celui qui tourne déjà), ouvre un tunnel et affiche un lien `https://…trycloudflare.com` à envoyer aux amis.
3. Laisse la fenêtre ouverte pendant la partie ; Ctrl+C coupe tout.

**Ailleurs (Railway, VPS avec nginx)** : `npm ci --omit=dev` puis `npm start` ; la variable `PORT` est lue automatiquement. Derrière nginx, ajouter les en-têtes WebSocket (`proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`) et `TRUST_PROXY=1`.

## Ajouter des questions

Tout se trouve dans `server/data/questions.js` :
- `QCM` : la **bonne réponse en premier**. Les choix sont mélangés à l'affichage.
- `TRUE_FALSE` : `a: true` ou `a: false`.
- `ESTIMATION` : `a` = la valeur, `unit` = l'unité affichée.
- `info` (facultatif) : une explication affichée pendant la correction.
- `typed` (QCM, facultatif) : la question est aussi posée en « Réponse tapée » dans le Quiz classique. À réserver aux réponses fermées et univoques (un nom, un nombre). `typed: true` accepte la bonne réponse ; `typed: ['…']` ajoute les autres écritures légitimes (surnom, nom anglais). Casse, accents, ponctuation et article en tête (« L' », « Le », « Un »…) sont ignorés, les fautes de frappe non.

Les questions déjà posées dans un salon ne reviennent pas avant que la banque soit épuisée.

Environ 260 QCM, 160 Vrai/Faux et 80 estimations (dont moins d'un quart sur des années). `npm test` vérifie la banque (format, doublons, 4 choix distincts) avec `test/questions-test.js`.

## Ajouter un nouveau jeu

- **Nouveau mode** construit sur les types existants : ajoute une entrée dans `MODES` (`server/games/index.js`). `inputs: true` affiche le réglage « Réponse » (4 choix / réponse tapée, reçu dans `settings.input`), `levels: true` le réglage « Niveau ».
- **Nouveau type de manche** (par exemple : remettre dans l'ordre, buzzer, dessin) : crée un module dans `server/games/` qui exporte `publicRound`, `validate`, `answerText`, `score` et `reveal`, sur le modèle de `qcm.js`. Enregistre-le dans `KINDS`, puis ajoute son affichage dans `public/js/views.js` (vues `question` et `reveal`).

Le moteur (salon, chrono, synchro, reconnexion, classement) ne change pas.

## Jaquette pixelisée

L'image se précise par paliers, de 4 colonnes de pixels au départ jusqu'à 48 ou 64 en fin de chrono. Elle devient reconnaissable par la plupart des joueurs quand il reste environ 30 % du temps (un peu plus tôt en saisie libre, pour laisser le temps de taper). Réglage : `PIX_LAST_AT` dans `public/js/media.js`. Le palier est calculé par chaque navigateur depuis l'horloge serveur : tout le monde voit le même niveau de détail au même instant. Elle n'est nette qu'à la correction. L'image est envoyée pendant le « 3, 2, 1 » et celle de la manche suivante pendant la correction, pour être chargée à temps partout.

Points : 1000 pour une réponse immédiate, 200 au buzzer. En saisie libre : 5 s de plus, 3 essais. Pas de faute de frappe ni de réponse partielle, mais on ignore la casse, les accents, la ponctuation, les espaces, « The » (partout dans le titre) et l'écriture des numéros (« GTA V » = « GTA 5 »). Sont aussi acceptés : les sigles des jeux connus par leur sigle (GTA, WoW, LoL…, alias dans `server/data/cover-games.js`) ; le titre sans mention d'édition ni « Remake » (« Final Fantasy VII » pour « Final Fantasy VII Remake », « Mario Kart 8 » pour « Mario Kart 8 Deluxe ») ; le titre du jeu de base pour une extension (champ `base`) ; et les raccourcis usuels des séries iconiques (« Zelda Breath of the Wild », « Isaac », « Skyrim », « Witcher 3 », « Sekiro »…, liste dans `server/games/fuzzy.js`). Ce qui est facultatif reste accepté si on le tape. Un test vérifie qu'aucune de ces écritures ne désigne deux jeux différents de la banque.

Limite assumée : comme pour les questions, un joueur qui ouvre les outils développeur peut afficher l'image nette.

## Pitch mal expliqué

Un jeu résumé de travers (mais exact) en une ou deux phrases, affiché d'un bloc. Deux niveaux, choisis par l'hôte : Facile (34 jeux très grand public, fausses propositions tout aussi connues) et Difficile (40 autres jeux). Mêmes points et mêmes règles de saisie que la jaquette (le module `games/pitch.js` réutilise `cover.js`).

Contenu : `server/data/pitches.js` (74 jeux, champ `level` : easy ou hard). Chaque pitch pointe vers un jeu de `cover-games.js`, d'où viennent le titre, l'année et les réponses acceptées. La jaquette s'affiche à la correction si elle est en cache, sinon le titre seul. Le mode marche sans clés IGDB. Pour retirer un pitch, supprimer son entrée.

## Le jeu en emojis

Un jeu raconté en quelques emojis (moment culte, mécanique, personnage), affiché d'un bloc. 4 choix ou réponse tapée, mêmes points et même validation stricte des titres que la jaquette (`games/emoji.js` réutilise `cover.js`). Deux niveaux, choisis par l'hôte : Facile (jeux très grand public, fausses propositions tout aussi connues) et Difficile. À la correction : le titre, la jaquette si elle est en cache, et l'explication des emojis.

Séries (`server/data/series.js`) : si la banque n'a qu'un jeu d'une série, le nom de la série suffit en réponse tapée (« Mario Kart » pour Mario Kart 8, « Tekken » pour Tekken 3). Si elle en a plusieurs (Zelda, Final Fantasy, GTA…), chaque énigme contient un indice propre à son épisode (numéro ou sous-titre en emoji) et il faut le titre de l'épisode (les raccourcis habituels comme « Zelda Breath of the Wild » ou « FF7 » passent). En 4 choix, jamais deux jeux de la même série.

Contenu : `server/data/emojis.js` (328 jeux : 99 faciles, 229 difficiles). Une énigme pointe soit vers un jeu de `cover-games.js` (champ `slug`), soit décrit un jeu hors liste (`title`, `year`, `aliases`), qui s'affiche alors sans jaquette. Emojis limités à Unicode 12 pour s'afficher partout. Le mode marche sans clés IGDB. Pour retirer une énigme, supprimer son entrée.

## Quel jeu fait ce bruit ?

Un son culte (pièce de Mario, « Hadouken ! », alerte de Metal Gear Solid…), il faut trouver le jeu. 4 choix ou réponse tapée, mêmes points et même validation stricte que la jaquette (`games/sound.js` réutilise `cover.js`).

- **Synchro** : le son est téléchargé et décodé pendant le « 3, 2, 1 », puis programmé (élément audio unique) pour partir à l'heure de début de la manche, sur l'horloge serveur : tout le monde l'entend au même instant. Chacun peut le réécouter autant qu'il veut (bouton rond), pendant la question et à la correction. Un navigateur bloque le son tant qu'on n'a pas touché la page : le moindre clic (pseudo, Rejoindre) le débloque, sinon le bouton affiche « Touche l'écran pour activer le son ».
- **Réponses** : le titre du jeu (règles de `fuzzy.js`). Pour un son repris dans toute une série (pièce de Mario, secret de Zelda, « Hadouken ! »), le nom de la série est aussi accepté (« Super Mario », « Zelda », « Street Fighter ») ; pour un son propre à un épisode (Navi dans Ocarina of Time), il faut l'épisode. Quand le son vient de toute une série sans épisode précis (Aku Aku, Counter-Strike), la réponse est la série, affichée « Série … ».
- **Correction** : le jeu, une phrase qui explique le son, la mention et le lien vers la source.
- **Consoles et boutiques** : quelques sons ne viennent pas d'un jeu (démarrage de la PS1, succès Xbox 360, succès Steam, « SEGA ! »…). Ils ont leur propre question, « Quelle console fait ce bruit ? », « Quelle plateforme… » ou « Quelle marque… », et les fausses propositions sont d’autres consoles, boutiques ou marques (`platform` dans `sounds.json`, liste `PLATFORMS` de `games/index.js`).
- **3 sons au plus par série** (Mario, Sonic, Street Fighter…), pour ne pas retomber sans cesse sur les mêmes ; les sons ajoutés par Liargo passent en priorité.
- **Pas de nom du jeu dans le son** : les voix ont été passées en reconnaissance vocale, et les sons qui prononcent le titre ont été retirés.
- Un jeu n'apparaît qu'une fois par partie ; pas de son réentendu dans un salon tant qu'il en reste. Présent dans le Mix.

Les sons sont dans `data/sounds/` (MP3 de 7 s au plus, volume harmonisé, sans métadonnées, noms aléatoires pour que l'URL ne trahisse pas le jeu), décrits par `data/sounds/sounds.json` (jeu, explication `what`, `seriesWide`, `series`, source). Servis sous `/sfx/<fichier>`, relus à chaud. L'hôte peut retirer un son en fin de manche (clé `sounds` de `data/blacklist.json`) ; le jeu reste jouable ailleurs.

**Provenance et droits** : 150 sons. Une partie vient de Myinstants (boutons envoyés par des internautes, page d'origine gardée dans `source.url`), les autres ont été ajoutés à la main par Liargo (nom du fichier d'origine dans `source.name`). Ce sont des extraits des jeux, qui appartiennent à leurs éditeurs : aucune licence. Ça passe pour un usage privé entre amis ; pour une mise en ligne publique, il faudrait les retirer ou obtenir des autorisations (un dossier à vider suffit, le mode se grise tout seul sous 4 sons).

Test : `node test/sound-test.js` (dans `npm test`).

## Mix

Le Mix pioche dans les modes que l'hôte coche dans les réglages (tous par défaut) : Quiz classique, Vrai ou faux, Estimation, Jaquette, Pitch mal expliqué, Le jeu en emojis et Quel jeu fait ce bruit ?. Il faut en garder au moins un. Un mode grisé (jaquettes pas encore chargées, aucun son) est simplement sauté ; si un mode coché manque d'images pour toutes ses manches, le Mix complète avec des questions.

- **Répartition** : parts égales entre les modes disponibles, le reste tiré au hasard (10 questions sur 7 modes : 1 de chaque et 3 modes en ont 2 ; 5 questions : 5 modes différents). Les manches sont mélangées sans deux manches du même mode d'affilée. Si un mode manque d'images (peu de sons, tous déjà entendus dans le salon), ses manches vont aux modes qui en ont le moins.
- **Réglages** : « Réponse » (Au hasard / 4 choix / tapée, Au hasard par défaut) s'applique au Quiz et aux modes « Quel est ce jeu ? » ; Vrai ou faux et Estimation ne changent pas. « Au hasard » tire chaque manche en 4 choix ou en réponse tapée, avec au moins une de chaque dans la partie. Réglages du salon : `mixInput` et `mixParts` (le mode seul garde son propre réglage `input`). « Niveau » s'applique au Pitch et aux emojis.
- **Chrono** : la durée choisie dans le salon pour toutes les manches, avec les mêmes 5 s de plus que dans chaque mode quand on tape (réponse tapée, estimation). Chaque manche garde ses règles (essais, dépixelisation, points).
- **Pas de doublon** : un jeu n'est à deviner qu'une fois par partie, édition comprise (FF7 et FF7 Remake comptent pour un) ; une question qui cite un jeu à deviner dans la même partie est écartée (elle soufflerait la réponse) ; pas de répétition d'une partie à l'autre dans un salon, comme pour chaque mode.
- **4 choix** (tous les modes « Quel est ce jeu ? », pas seulement dans le Mix) : jamais deux épisodes d'une même série ni deux éditions d'un même jeu parmi les propositions.

Test : `test/mix-test.js` (dans `npm test`).

## Mots croisés

Une partie = une seule manche au chrono fixe (5, 10, 15 ou 20 min : le réglage « Durée » du salon). Chacun enchaîne des grilles de 10 mots (9 × 9 cases max) à son rythme ; les grilles sont les mêmes pour tout le monde, dans le même ordre.
- On choisit une définition (ou une case), on tape le mot entier dans la case de saisie ; la grille montre la saisie en direct. Le mot part au serveur dès qu'il a toutes ses lettres. Juste : verrouillé en vert. Faux, ou saisie arrêtée 2 s en cours de mot : il clignote en rouge et s'efface (les lettres déjà trouvées restent).
- Une grille est validée dès 8 mots sur 10 : on passe aussitôt à la suivante.
- Classement : le plus de grilles validées, puis le plus de mots dans la grille en cours, puis le premier à avoir trouvé son dernier mot. Points = 1000 par grille + 100 par mot de la grille en cours ; le départage par l'heure désigne aussi le vainqueur dans le score global.
- Mots et définitions : `server/data/crosswords.js` (`word` en A-Z sans accent, 3 à 9 lettres, `clue`, `level` easy/hard). Grilles fabriquées à la demande (`server/games/crossword.js`), sans reprendre un mot déjà vu dans le salon tant qu'il en reste. Le navigateur n'a jamais les mots (événement `game:word`).
- Pas dans le Mix.
- Test : `node test/crossword-test.js`.

## Propositions des amis et Supabase

Page **/proposer** (lien dans le salon) : tous les modes sauf les mots croisés.
Chaque proposition arrive avec le statut `pending` ; elle est vérifiée puis intégrée dans `server/data/…`
(ou refusée), et son statut passe à `accepted`, `rejected` ou `doubt` (question à trancher par le client).

Stockage (`server/store.js`) :
- **En ligne** : Supabase gratuit (`SUPABASE_URL`, `SUPABASE_SECRET_KEY` dans Render et `.env`). Tables créées
  par `supabase/schema.sql` (à coller une fois dans SQL Editor). Les images et sons vont dans le bucket privé
  `submissions`. La clé secrète reste sur le serveur : le navigateur ne parle jamais à Supabase.
- **Sans ces variables** (PC, tests) : `data/submissions/` en local (non suivi par git).

Aussi dans Supabase :
- `reports` : les signalements ⚑ de l'hôte (le disque de Render est effacé à chaque mise en veille).
- `content` : une **copie en lecture** de tout le contenu du jeu, pour filtrer et trier dans le Table Editor.
  Réécrite au démarrage du serveur quand le contenu a changé. La modifier ne change pas le jeu.

Commandes : `npm run submissions` (en attente), `npm run submissions -- --all`,
`npm run submissions -- --status <id> accepted "note" "questions.js"`, `npm run submissions -- --file <id>`,
`npm run feedback` (lit Supabase si les clés sont dans `.env`).

Pause d'un projet Supabase gratuit après 7 jours sans activité : le serveur interroge Supabase à chaque
démarrage et une fois par jour, et `.github/workflows/keepalive.yml` réveille le serveur tous les 3 jours.

## Structure

```
server/
  index.js        serveur HTTP + Socket.IO
  rooms.js        création / accès aux salons, routage des événements
  room.js         moteur de partie (phases, chrono, réponses, scores)
  games/          logique de chaque type de manche (cover.js = jaquettes, fuzzy.js = comparaison des titres tapés)
  images/         fournisseurs d'images (igdb.js), cache disque, liste noire, sons (sounds.js)
  data/           banques de questions, liste des jeux à jaquette
data/blacklist.json  jeux et images retirés
data/sounds/     sons du mode « Quel jeu fait ce bruit ? »
.cache/images/   jaquettes téléchargées (non versionné)
public/
  index.html, *.css  page unique et habillages (ordre des CSS : voir CLAUDE.md)
  js/             client en 17 petits scripts (synchro d'horloge, rendu des écrans…) ; plan : docs/CODEMAP.md
test/             tests bout-en-bout multi-joueurs (sync-test.js, cover-test.js, pitch-test.js, emoji-test.js…) quiz-text-test.js et vérification de la banque (questions-test.js)
scripts/covers.js  rapport des jaquettes (npm run covers)
deploy/           installation et mise à jour sur une VM (install.sh, update.sh)
render.yaml       description du service Render
```

## Signaler une question (hôte)
Pendant une question ou sa correction, l'hôte a un bouton **⚑ Signaler** : la partie se met en pause pour
tout le monde (chronos figés à la même heure serveur, réponses refusées, rien ne passe à la suite), puis
l'hôte choisit le type de retour (réponse à accepter en plus, bonne réponse fausse, question à supprimer,
autre) et ajoute un commentaire. « Envoyer et reprendre » relance la partie là où elle en était.
Les retours sont ajoutés à `data/feedback.jsonl` (une ligne JSON par retour, avec la question complète et
les réponses des joueurs ; non suivi par git). Lecture lisible : `npm run feedback`. Autre emplacement :
variable `FEEDBACK_FILE`.
