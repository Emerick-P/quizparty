# Plan du code (généré par `npm run codemap`, ne pas modifier à la main)

Données (`server/data/*.js`) et tests (`test/`) non listés. Ordre de chargement du client : core → device → net → session → actions → propose → media → crossword → widgets → tv-views → home → stats → ranking → nav → daily → challenges → live → views → render → main.

### server/auth.js (175 l.)
Comptes joueurs (facultatifs) : connexion Discord / Google via Supabase Auth.

PROVIDERS, CACHE_MS, clip, profileOf, createAuth

### server/avatars.js (40 l.)
Images de profil : galerie maison (un emoji sur une couleur), la photo du compte Discord/Google, ou l'initiale.

AVATAR_EMOJIS, AVATAR_HUES, cleanLook, photoOf, defaultLook, lookView

### server/challenges.js (270 l.)
Défis entre potes : un joueur connecté fige une série de questions et partage un lien (/?c=CODE).

CHALLENGE_ROUNDS, CHALLENGE_DURATIONS, CHALLENGE_DAYS, CHALLENGE_DEFAULTS, EXCLUDED, ALPHABET, CODE_LEN, newCode, cleanCode, playerKey, ctxOf, challengeModes, publicResult, Challenges, ChallengeRoom, startChallenge

### server/content-sync.js (44 l.)
Copie EN LECTURE du contenu du jeu dans la table Supabase « content », pour que le client puisse

ROOT, readJson, contentRows, syncContent

### server/daily.js (432 l.)
Défi du jour : le même quiz figé pour tout le monde, de minuit à minuit (heure de Paris).

DAILY_ROUNDS, DAILY_DURATION, DAILY_PARTS, NO_REPEAT_DAYS, TZ, dayFmt, dayKey, shiftDay, previousDay, nextDayAt, cellOf, CELL, gridText, recordStats, hasDb, unavailable, refreshImages, shuffleChoices, Daily, publicResult, DailyRoom, startDaily, openDaily

### server/env.js (7 l.)
Charge le fichier .env s'il existe (Node 20.12+). Importé en premier par server/index.js.

### server/feedback.js (85 l.)
Retours des joueurs sur une question (bouton ⚑ Signaler pendant la partie).

ROOT, FEEDBACK_FILE, FEEDBACK_TYPES, MODERATOR_TYPES, clip, snapshot, makeFeedback, feedback

FEEDBACK_TYPES : accept, wrong, remove, other

feedback : file, add, list

### server/index.js (161 l.)


__dirname, app, server, io, PUBLIC, auth, version, sendIndex, siteOrigin, MANIFEST, mediaRoute, rooms, PORT, HOST

### server/legal.js (139 l.)
Pages légales, ouvertes à tous : Google les lit avant d'autoriser

esc, UPDATED, page, contactLine, privacyPage, termsPage, installLegal

### server/live.js (455 l.)
Quiz en direct, en solo : à heure fixe (heure de Paris), tout le monde reçoit les mêmes questions au même instant.

LIVE_TZ, LIVE_OPEN_MS, LIVE_MAX_PLAYERS, LIVE_REVEAL_MS, VERSUS_NEIGHBOURS, NO_REPEAT, PARTS, LIVE_FORMATS, DEFAULT_SLOTS, slotTable, partsFmt, parisParts, parisTime, hmOf, dayOf, addDay, WEEKDAYS, whenOf, TEST_SLOT, eventTable, slotsOf, nextSlot, publicSlot, formatOf, buildLive, shuffled, hasChoices, LiveRoom, Live

LIVE_FORMATS : midi, brunch, soir, nuit, finale

DEFAULT_SLOTS : week, sat, sun

### server/rating.js (355 l.)
Cote des joueurs (type Glicko-2), calculée surtout contre la cote des QUESTIONS.

RATING, RATED_MODES, SCALE, DAY, ROOT, norm, questionKey, roundKey, guessOf, outcomeOf, priors, priorOf, questionStart, monthFmt, seasonOf, tierOf, publicRating, gOf, logistic, inflate, terms, glicko, versusScore, createRatings

RATING : start, rd, vol, tau, minRd, maxRd, placement, question, weights, versus, versusMax, minAnsweredShare, season

### server/room.js (1036 l.)
---- Réglages du moteur (surchargeables par variables d'environnement, utile pour les tests)

COUNTDOWN_MS, REVEAL_MS, ANSWER_GRACE_MS, MAX_LATENCY_COMP_MS, LOBBY_REMOVE_AFTER_MS, HOST_HANDOFF_AFTER_MS, GUESSES_SHOWN, MAX_PLAYERS, SCREEN_GRACE_MS, OPTIONS, cleanName, shortId, Room

### server/rooms.js (318 l.)
Pas de I ni O pour éviter les confusions avec 1 et 0

ALPHABET, EMPTY_ROOM_TTL_MS, RoomManager

### server/stats.js (200 l.)
Stats des joueurs connectés (comptes Supabase).

contentIndex, contentIdOf, INPUT_OF_KIND, answerRow, createStats, normalize, computeStats, stats

### server/steam.js (173 l.)
Profils Steam des joueurs (API Steam Web, gratuite, profils publics seulement).

API, KEY, CACHE_MS, TIMEOUT_MS, PRIVACY_URL, cache, steamEnabled, gameImage, parseProfile, call, loadProfile, ACH_GAMES, appCache, appAchievements, pool, inFlight, loadAchievements, fetchAchievements

### server/store.js (193 l.)
Stockage des soumissions des amis et des signalements ⚑ de l'hôte.

ROOT, BUCKET, supabaseBackend, localBackend, createStore, store

### server/submissions.js (158 l.)
Formulaire « Proposer » : les amis soumettent du contenu pour tous les modes (sauf mots croisés,

clip, AUDIO_TYPES, MAX_AUDIO, SUBMIT_MODES, knownGames, decodeFile, parseSubmission, limiter, reservedOk, installSubmissions

SUBMIT_MODES : quiz, vraifaux, estimation, covers, pitch, emoji, sounds

### server/games/bande.js (438 l.)
« Ta bande » : questions tirées des profils Steam liés par les joueurs du salon.

MIN_LINKED, ONCE, GROUP, shuffle, nf, hoursText, picture, linkedPlayers, bandeUnavailable, choiceRound, playerChoices, topGame, JUNK, LEGACY, familyKey, shameCandidates, shame, hours, mostHours, recent, df, dayf, pctText, rankQuestion, binge, lastPlayed, perfect, rarestOf, rarest, accountAge, steamLevel, library, gameCount, friendship, buildBande, spreadAbout

### server/games/cover.js (91 l.)
Jaquette pixelisée : une jaquette s'affiche très pixelisée et se précise au fil du chrono.

TEXT_TRIES, PIX_COLS, PIX_LAST_AT, PIX_PREFETCH_MS, pixLevels, MAX_GUESS_LENGTH, isCorrect

### server/games/crossword.js (253 l.)
Mots croisés, partie au chrono : une seule manche, d'une durée fixe (5 à 20 min), pendant laquelle chacun

GRID_MAX, TARGET_WORDS, VALIDATE_AT, MIN_WORDS, rand, shuffle, plain, clueWords, tryLayout, finalize, makeGrid, cellsOf, GRID_POINTS, publicGrid, emptyProgress, foundCount, pointsOf, gridAt

### server/games/emoji.js (27 l.)
Le jeu en emojis : deviner un jeu à partir d'une suite d'emojis. Plus on trouve tôt, plus on marque.

### server/games/estimation.js (64 l.)
Estimation : chacun propose un nombre, le plus proche gagne.

RANK_POINTS, YEAR_SCALE, nf, formatNumber, formatValue

### server/games/fuzzy.js (146 l.)
Comparaison d'un titre tapé par un joueur avec les réponses acceptées.

LEADING_ARTICLES, AND, ROMAN, tokensOf, normalize, keys, matches, EDITION, baseTitles, SHORTCUTS, NUMBERED_SUBTITLE, shortTitles, answersFor

### server/games/index.js (621 l.)


KINDS, shuffle, pick, makeQcm, makeTf, LEADING, makeTyped, TYPED, makeEstimation, acceptedAnswers, distractors, gameKey, avoidSkip, remember, buildCovers, coverUnavailable, GAME_BY_SLUG, buildPitches, emojiGame, emojiKey, EMOJI_ITEMS, EMOJI_SERIES_TITLES, EMOJI_SERIES_COUNT, emojiAnswers, buildEmojis, titleKey, soundAnswers, PLATFORMS, SOUND_PROMPT, buildSounds, soundsUnavailable, buildCrosswords, MIX_PARTS, QUIZ_PARTS, GUESS_BUILD, FIXED_INPUT, QUIZ_BUILD, spoilers, mentions, spread, MIX_INPUTS, mixPartsOf, buildMix, MODES, RESERVED_MODES, allowed, modeList

PLATFORMS : console, store, brand

GUESS_BUILD : covers, pitch, emoji, sounds, bande

QUIZ_BUILD : quiz, vraifaux, estimation

MODES : quiz, vraifaux, estimation, covers, pitch, emoji, sounds, crossword, mix, bande

### server/games/pitch.js (28 l.)
Pitch mal expliqué : le résumé tordu (mais exact) d'un jeu, en une ou deux phrases.

### server/games/qcm.js (31 l.)
Question à choix (QCM 4 choix, ou Vrai/Faux à 2 choix).

### server/games/sound.js (37 l.)
Quel jeu fait ce bruit ? : un son court (pièce de Mario, « Hadouken ! »…), il faut trouver le jeu.

### server/games/typed.js (43 l.)
Question à réponse tapée (Quiz classique en « Réponse tapée »).

TEXT_TRIES, MAX_GUESS_LENGTH, isCorrect

### server/images/igdb.js (119 l.)
Fournisseur d'images IGDB (base de données de jeux de Twitch).

TOKEN_URL, API_URL, IMAGE_URL, sleep, MIN_GAP_MS, SLUG_YEAR_TOLERANCE, SEARCH_YEAR_TOLERANCE, FIELDS, quote, simplify, yearOf, igdbConfig, createIgdbProvider

### server/images/index.js (207 l.)
Bibliothèque de jaquettes : fait le lien entre la liste de jeux, un fournisseur d'images

ROOT, EXT, MIME, RETRY_MISSING_AFTER_MS, readJson, writeJson, sharpLib, loadSharp, CoverLibrary, covers

### server/images/sounds.js (141 l.)
Sons du mode « Quel jeu fait ce bruit ? ».

ROOT, FILE_RE, readJson, SoundLibrary, sounds

### public/js/actions.js (253 l.)
Actions des boutons (data-action) : créer/rejoindre, répondre, réglages de l’hôte…

getName, answer, copiedUntil, COPIED_MS, copyText, copyCode, share, actions

actions : rvpage, theme, create, join, leave, getapp, installhide, install, tvsheet, tvclose, tvoff, copycode, start, skip, stop, lobby, resetTotals, steamLink, steamHelp, steamHelpClose, noop, steamUnlink, kick, set, mixpart, answer, ban, replay, pause, login, logout, saveName, deleteAccount, flag, flagclose, resume, reportType, reportPick, reportSend

### public/js/challenges.js (197 l.)
Défis entre potes.

DEVICE_KEY, POTES_KEY, potes, potesDevice, potesRemember, potesLink, potesLeft, potesSettings, loadPotes, loadPote, potesTile, potesBody, poteBody, potesEnd

actions : defis, defiset, deficreate, defiopen, defiplay, defishare, defihome

### public/js/core.js (125 l.)
Utilitaires partagés : $, esc, stockage local, thème, toast, code dans l’URL.

app, esc, nf, hue, SHAPES, KIND_LABEL, kindLabel, LEVEL_LABEL, INPUT_LABEL, MIX_INPUT_LABEL, GUESS_KINDS, TYPED_KINDS, MODE_GROUPS, ICONS, ico, MODE_ART, modeArt, store, SESSION_KEY, NAME_KEY, THEME_KEY, STEAM_KEY, AUTH_KEY, currentTheme, setTheme, themeToggle, emojiLine, toast, urlCode, setUrlCode

ICONS : tv, bulb, copy, lock, info, trophy, gamepad, phone, download, calendar, swords, flame, share, user, users, chart, palette, pencil, flag, pause, timer, zap, vol0, vol1, vol2, vol3, check, x, back, help, scale, target, image, chat, smile, music, grid, shuffle

MODE_ART : quiz, covers, sounds, bande

store : get, set, del

### public/js/crossword.js (252 l.)
Mots croisés : grille, saisie, envoi des mots.

CW_IDLE_MS, cw, cwCells, cwLetters, cwPlaying, cwLocked, cwFound, LETTERS, cwLabels, cwWord, cwSync, cwSetTyped, cwNext, cwChoose, cwFocus, cwWrong, cwSubmit, cwOnInput, cwGrid, cwClues, crosswordQuestion

### public/js/daily.js (188 l.)
Défi du jour.

DAILY_KEY, daily, CELL_CLASS, GRID_CELL, gridCells, prevDay, dailyMine, dailyStreak, MOCK_DAILY, mockDaily, loadDaily, cellsHtml, fmtPts, untilNext, shareTextOf, shareDaily, dailyBoard, dailyCard, dailyBody, rememberDaily, dailyProgress, dailyBar, dailyEnd

actions : dailystart, dailyshare, dailyhome

### public/js/device.js (110 l.)
Appareil : écran télé (/tv), app installée (PWA), vibrations.

SCREEN, TV_KEY, tv, controller, fullHint, STANDALONE, IOS, pwa, INSTALLED_KEY, INSTALLED_MSG, appInstalled, NOINSTALL_KEY, installTop, getAppBody, keepAwake, buzz, buzzedFor, buzzOnPhase

### public/js/home.js (330 l.)
Accueil et salon : pages, panneaux, profil, avatar.

WIDE_MQ, wide, ui, modeGroups, HOME_TABS, homeUi, homeTab, tabButtons, tabBar, barTabs, COTE_KEY, coteCache, rankIndex, saveCote, loadHomeRating, ordinal, rankPreview, coteCard, homeComp, homePlay, settingsTags, heroCard, settingsBody, playersList, SHEETS, providerIcon, loginTop, lookUi, lookBody, profileBody, accountBlock

actions : tab, pickHue, pickLook

SHEETS : name, create, join, live, daily, defis, defi, getapp, tvinfo, games, settings, players, steam, scores, account, look, menu, stats, ranking, more

### public/js/live.js (145 l.)
Quiz en direct.

live, liveTime, liveDay, LIVE_KEY, liveResult, loadLive, liveStrip, liveBody, liveResultBody, liveWait, liveEnd

actions : liveslot, livejoin, livehome

### public/js/main.js (26 l.)
Démarrage, une fois tous les scripts chargés (les tâches asynchrones ne partent qu'ici,

potesUrl

### public/js/media.js (235 l.)
Jaquettes pixelisées, sons (« Quel jeu fait ce bruit ? »).

images, loadImage, PIX_PREFETCH_MS, drawCover, drawClearCover, coverFigure, SILENT_MP3, sfx, SFX_LATE_MS, VOLUME_KEY, sfxVolume, volumeGain, volumeSettable, setVolume, volumeIcon, audioEl, audioBlocked, unlockAudio, loadSound, stopSound, playSound, syncSound, replaySound, soundFigure, updateSoundUi

### public/js/nav.js (221 l.)
Bandeau du haut, menu du profil, ouverture/fermeture des panneaux.

BAR_PHASES, hasBar, appBar, menuBody, sheetView, sheetHtml, OVER, openSheet, dropSheet, closeSheet, onPage, leaveAsk, navSkip, navRoom, navLayers, navSync, navPop, askLeave, leaveNow, leaveOverlay

actions : navhome, sheet, sheetclose, soon, propose, go, pick, leaveok, leavecancel, toroom

### public/js/net.js (67 l.)
Connexion temps réel : socket, horloge serveur (façon NTP), send(), état global (state, pending).

socket, clock, now, shownNow, sampleClock, syncClock, send, state, pending, renderedPhase, resuming

### public/js/propose.js (121 l.)
Panneau « Proposer » et saisie des réponses (rappel des essais avec ↑).

PROPOSE_PHASES, proposeButton, proposePanel, proposeOpen, openPropose, closePropose, updatePropose, recall, rememberGuess

actions : propose

### public/js/ranking.js (56 l.)
Classement général par cote (saison du mois en cours).

rankUi, MONTHS, seasonLabel, rankAvatar, MOCK_RANK, mockRanking, loadRanking, rankingBody, RATING_PLACEMENT

actions : ranking

### public/js/render.js (174 l.)
Rendu : morph du DOM, swipe de la correction, chronos à chaque frame.

sameNode, morphNode, morphChildren, render, SWIPE_HINT_KEY, swipeSeen, swipeHints, updateSwipe, updateTimers, frame

### public/js/session.js (183 l.)
Compte (Discord/Google), écran télé, événements du serveur, reprise de session, phase affichée.

account, PROVIDER_LABEL, accountConfig, accountRefresh, accountSync, accountLost, tvConnect, steamAutoFor, autoLinkSteam, resume, enterRoom, leaveLocal, displayPhase

### public/js/stats.js (115 l.)
Stats de joueur (Mes stats, stats d’un joueur du salon).

statsUi, fmtRating, ratingText, ratingEnd, STATS_TABS, pct, secs, openStats, showStatsTab, statsBody

actions : mystats, pstats, stab

### public/js/tv-views.js (148 l.)
Mode télé : vues de l’écran télé et du téléphone en manette.

TOUCH, tvCard, tvSheet, tvPairView, tvLobbyView, tvQuestion, tvCrossword, padQuestion

### public/js/views.js (343 l.)
Écrans de jeu par phase (views[phase]) : salon, décompte, question, correction, podium…

views

views : tvpair, tvlobby, loading, home, lobby, countdown, question, reveal, end

### public/js/widgets.js (302 l.)
Morceaux d’écran partagés : pause, signalement, Steam, avatars, classements, liste des joueurs.

isHost, report, REPORT_TYPES, PLAYER_TYPES, reportButton, playerBar, typedRound, missedAnswers, pauseOverlay, flagOverlay, reportForm, gamePicture, aboutLine, steamHelpOpen, steamHelpOverlay, steamCard, LOOK_KEY, looks, photoOf, lookView, myLookRaw, myLook, lookOfName, avatar, myAvatar, sortedByScore, sortedByTotal, globalBoard, shownStatus, STATUS_BADGE, guessBody, roster, cwRoster

STATUS_BADGE : answered, found, missed

### scripts/codemap.js (68 l.)
Plan du code généré : docs/CODEMAP.md (fichier → rôle → déclarations de premier niveau).

ROOT, OUT, DIRS, EXTRA, DECL, ACTION, describe, entry, files, order, md

### scripts/covers.js (21 l.)
Rapport des jaquettes : télécharge celles qui manquent et liste les jeux introuvables.

rows, bad, banned, yearGaps

### scripts/feedback.js (27 l.)
Affiche les retours de l'hôte enregistrés pendant les parties : npm run feedback

online, list, where

### scripts/rating-backfill.js (49 l.)
Reprise des réponses déjà en base pour la cote (à lancer une fois, après la migration 2026-11-27-cote.sql).

dry, keyOf, games, ratings, done, counted

### scripts/share.js (126 l.)
npm run share : lance le serveur (s'il ne tourne pas déjà) + un tunnel Cloudflare gratuit,

ROOT, PORT, LOCAL, children, findCloudflared, serverIsUp, waitForServer, stopAll, banner, main

### scripts/submissions.js (45 l.)
Propositions des amis : npm run submissions [-- options]

### public/proposer.js (199 l.)
Page « Proposer » : formulaire de soumission des amis (aucune dépendance).
