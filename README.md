# CR War Bot — suivi des guerres de clans Clash Royale

Bot Discord multi-clans : decks de guerre non utilisés, joueurs n'ayant pas combattu,
rappels à **pression progressive** et rapport de fin de guerre.

## Fonctionnalités
- **Multi-clans** : `/clan ajouter`, `/clan retirer`, `/clan liste` (un salon par clan).
- **`/guerre statut [clan]`** : joueurs avec 0/4 combats et ceux avec des decks restants (aujourd'hui).
- **Rappels automatiques à pression progressive** : 🟡 6h → 🟠 3h → 🔴 1h avant le reset des decks
  (10:00 UTC). Ping Discord des joueurs liés, noms des autres dans l'embed. Seuils réglables avec `/pression`.
- **`/guerre rappel [clan]`** : rappel manuel immédiat.
- **Rapport de guerre** : posté automatiquement à la fin de chaque guerre (classement, fame, top 3,
  joueurs sans combat, decks non utilisés sur 16). Aussi disponible via `/guerre rapport`.
- **`/lier` / `/delier`** : associe un tag joueur à un membre Discord pour les pings.

## Installation
1. **Discord** : https://discord.com/developers/applications → New Application → Bot → copie le token.
   Invitation : scopes `bot` + `applications.commands`, permissions *Envoyer des messages* et *Intégrer des liens*.
2. **Clash Royale API** : https://developer.clashroyale.com → My Account → Create Key.
   - Avec le proxy RoyaleAPI (par défaut), mets l'IP **45.79.218.79** dans la clé.
   - Sinon, mets l'IP fixe de ton serveur et `CR_API_BASE=https://api.clashroyale.com/v1`.
3. ```bash
   cp .env.example .env   # puis remplis les tokens
   npm install
   npm start
   ```
   (Node 18.17+). Pour tourner 24/7 : VPS + `pm2 start src/index.js --name cr-war-bot`.
4. Sur Discord : `/clan ajouter tag:#XXXX salon:#guerre`, puis chaque joueur fait `/lier tag:#YYYY`.

## Notes
- Les données (clans, liens, rappels envoyés) sont dans `data/db.json`.
- Les rappels ne partent que pendant les jours de guerre (pas les jours d'entraînement).
- Reset des decks : 10:00 UTC (modifiable via `RESET_HOUR_UTC` / `RESET_MINUTE_UTC`).
- Clash Royale est une marque de Supercell. Projet non affilié.
