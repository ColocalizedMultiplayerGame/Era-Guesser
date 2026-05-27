# EraGuesser

**Lien de clonage :** `https://<votre-username>:<pat>@github.com/DevByNightt/EraGuesser.git`

*Note : Si vous n'utilisez pas de Personal Access Token (PAT), vous devrez saisir votre mot de passe GitHub lors de chaque interaction avec le dépôt. Vous pouvez en générer un dans [settings/tokens](https://github.com/settings/tokens).*

---

## Présentation
EraGuesser est un jeu multijoueur local conçu pour être utilisé dans un cadre collectif (salle de classe, conférence ou salon). Le concept s'inspire de GeoGuessr : les participants doivent identifier le lieu et l'année de capture d'une photographie historique.

L'expérience repose sur un gameplay asymétrique :
* **Écran principal :** Un navigateur affiché via un vidéoprojecteur présente les épreuves et les résultats.
* **Contrôleurs :** Chaque joueur utilise son smartphone (tenu à la verticale) comme interface de jeu.
* **Direction artistique :** L'interface adopte une esthétique inspirée des dossiers confidentiels et des bureaux de détectives du milieu du XXe siècle.

---

## Instructions de jeu

### Configuration pour l'organisateur
1.  Installez l'environnement **Node.js** (disponible sur https://nodejs.org/).
2.  Exécutez le fichier **`start.bat`** à la racine du projet. Ce script initialise le serveur et crée un tunnel sécurisé pour l'accès externe.
3.  Une page web s'ouvrira automatiquement. Projetez cet écran pour les participants.
4.  Une fois les joueurs connectés, lancez la session via l'interface d'administration.

### Instructions pour les participants
1.  Scannez le **QR Code** affiché sur l'écran principal pour rejoindre la partie.
2.  Saisissez un pseudonyme.
3.  Maintenez votre téléphone en mode portrait durant toute la session.
4.  Un mini-jeu d'attente est disponible dans le lobby avant le début de la partie.

---

## Déroulement d'une partie

Une session se compose de trois manches de 45 secondes chacune, structurées ainsi :

1.  **Observation** : Une photographie historique est affichée sur l'écran commun.
2.  **Investigation** : Sur le smartphone, le joueur place un marqueur sur une carte du monde et sélectionne une année via un curseur. La validation doit être effectuée avant la fin du compte à rebours.
3.  **Temps mort** : Les joueurs ayant validé prématurément peuvent retourner au mini-jeu en attendant les autres participants.
4.  **Résultats et contexte** : À la fin du chrono, un rapport de manche s'affiche sur les téléphones. L'écran principal révèle la solution, accompagnée d'un texte explicatif sur le contexte historique de l'image.

Le score final est calculé selon la précision géographique (distance) et temporelle (proximité de l'année). 

---

## Mini-jeu : Border Drop
Pour occuper les temps d'attente, l'interface mobile intègre "Border Drop". L'objectif est de rattraper des pays appartenant au continent indiqué en faisant glisser un réceptacle au bas de l'écran.

---

## Spécifications techniques

Le jeu fonctionne intégralement via navigateur web, sans installation requise pour les joueurs.

### Backend (Serveur)
* **Node.js & Express.js** : Gestion de la logique de jeu et distribution des ressources.
* **Socket.io** : Communication bidirectionnelle en temps réel pour la synchronisation des scores et des états du jeu.
* **Untun (Cloudflare Tunnel)** : Exposition sécurisée du serveur local permettant la connexion via les réseaux mobiles (4G/5G) sans configuration complexe du réseau local.

### Frontend (Client)
* **Interface** : HTML5, CSS3 (variables CSS, Flexbox) et JavaScript natif. L'interface utilise des textures et des typographies rétro pour renforcer l'immersion.
* **Cartographie** : Leaflet.js et OpenStreetMap pour la gestion de la carte interactive et le calcul des distances via la formule de Haversine.