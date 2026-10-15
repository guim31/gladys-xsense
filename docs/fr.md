# X-Sense

> **La sécurité d'abord.** Gladys ne remplace **pas** les sirènes de vos détecteurs, et ce n'est pas un service de
> télésurveillance. Les alarmes passent par le cloud X-Sense : elles arrivent dans Gladys après **quelques secondes**
> (parfois plus), et pas du tout si votre accès internet, le cloud X-Sense ou Gladys est en panne. Servez-vous de
> cette intégration pour ajouter des notifications et des automatismes (lumières, chauffage coupé, message à un
> voisin), jamais comme seule alerte.

## Présentation

Cette intégration amène dans Gladys les **détecteurs X-Sense de fumée, de monoxyde de carbone (CO), de chaleur et
de fuite d'eau**, par le cloud X-Sense — celui qu'utilise l'application **X-Sense Home Security** :

- un appareil Gladys par détecteur : **alarme en cours**, **batterie**, **en ligne**, **signal radio ou Wi-Fi** et
  **dernier test** ;
- un appareil Gladys par **station de base** (SBS50, SBS10) : **en ligne** et **signal Wi-Fi** ;
- des **déclencheurs de scène** : alarme incendie, alarme CO, fuite d'eau et batterie faible, avec le nom et la pièce
  du détecteur ;
- un **widget** de tableau de bord qui liste tous les détecteurs, alarmes en tête.

Les alarmes arrivent **en direct** (le même canal de notification que l'application), et l'intégration relit aussi
le cloud toutes les quelques minutes, par sécurité.

_Développée sans le matériel : vos retours sont les bienvenus._ Cette intégration n'est **pas affiliée à X-Sense** ;
X-Sense est une marque de son propriétaire.

## Prérequis

- Des détecteurs X-Sense liés à un **compte X-Sense** dans l'application X-Sense Home Security : détecteurs radio
  appairés à une station de base **SBS50** (ou SBS10), ou détecteurs Wi-Fi (XS01-WX, XC04-WX, SC07-WX…).
- L'e-mail et le mot de passe de ce compte. Un compte créé par « Se connecter avec Google/Apple » n'a pas de mot de
  passe : créez un compte classique.
- **Un second compte X-Sense pour Gladys** (fortement conseillé) : un même compte ne peut pas rester connecté à
  l'application et à Gladys à la fois, chacun déconnecterait l'autre sans cesse. Créez un second compte dans
  l'application, puis partagez-lui vos détecteurs depuis votre compte principal (le même conseil que l'intégration
  Home Assistant).
- Gladys **5.1.0** ou plus récent, avec un accès internet.

## Configuration

Dans Gladys, **Intégrations → X-Sense → Configuration** :

| Champ                                | Description                                                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E-mail                               | E-mail du compte X-Sense.                                                                                                                                                                        |
| Mot de passe                         | Son mot de passe. Conservé par Gladys ; l'intégration ne garde que les jetons de session dans son volume privé `/data`.                                                                          |
| Langue des noms de fonctionnalités   | Langue des noms de fonctionnalités d'un **nouvel** appareil (Gladys garde le nom d'une fonctionnalité une fois créée) et des résultats d'auto-test. Français par défaut.                         |
| Intervalle de lecture du cloud (min) | Minutes entre deux lectures complètes du cloud (1 à 60, 5 par défaut). Les alarmes ne l'attendent pas : elles arrivent en direct. Cette lecture rafraîchit les niveaux de batterie et de signal. |

Enregistrez, puis appuyez sur **Tester la connexion** : le résultat liste les détecteurs trouvés. Ouvrez l'onglet
**Découverte** et ajoutez les appareils voulus.

**Quotas et conditions d'utilisation.** X-Sense ne publie pas d'API publique : l'intégration utilise l'API privée de
l'application, comme l'intégration Home Assistant, en lecture seule. Pour ménager les serveurs X-Sense, elle lit la
liste des appareils toutes les 30 minutes, l'état de chaque station de base à l'intervalle ci-dessus (5 minutes par
défaut, le rythme de l'intégration Home Assistant), et garde une seule connexion en direct par compte. Ne descendez
pas sous ce dont vous avez besoin. X-Sense peut modifier ou fermer cette API à tout moment.

## Appareils

**Détecteur** (un par détecteur de fumée, CO, combiné, chaleur ou fuite d'eau) :

| Fonctionnalité | Valeurs                                                                                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alarme fumée   | 1 quand le détecteur est en alarme fumée (détecteurs de fumée et combinés).                                                                                                                  |
| Alarme CO      | 1 quand le détecteur est en alarme monoxyde de carbone (détecteurs de CO et combinés).                                                                                                       |
| Alarme chaleur | 1 quand le détecteur de chaleur est en alarme. Affichée comme un détecteur de fumée : Gladys n'a pas de catégorie chaleur, et c'est une alarme incendie.                                     |
| Fuite d'eau    | 1 quand le détecteur de fuite détecte de l'eau.                                                                                                                                              |
| Batterie       | Batterie en %. X-Sense ne donne que 4 niveaux : 0, 33, 67 ou 100 %. 33 % et moins, c'est « faible ».                                                                                         |
| En ligne       | 1 quand le détecteur communique avec sa station de base (ou avec le cloud pour un détecteur Wi-Fi).                                                                                          |
| Signal radio   | Détecteurs radio : 0 à 3 barres vers la station de base.                                                                                                                                     |
| Signal Wi-Fi   | Détecteurs Wi-Fi : signal en dBm (-100 à -40).                                                                                                                                               |
| Dernier test   | Résultat et date du dernier auto-test (bouton appuyé sur le détecteur ou test depuis l'application), par ex. « Réussi · 12/10/2026 10:03 ». Vide jusqu'au premier test après l'installation. |

**Station de base** (SBS50, SBS10) : **En ligne** et **Signal Wi-Fi** (dBm).

Tout est en lecture seule. Le niveau de CO en ppm, quand le détecteur le donne, est affiché par le widget et transmis
par le déclencheur « Alarme CO » (Gladys n'a pas de fonctionnalité de niveau de CO pour l'afficher).

## Widget

**Détecteurs X-Sense** : trois tuiles (détecteurs en alarme, batteries faibles, appareils hors ligne) et une ligne
par détecteur — nom, pièce, état et batterie — avec les alarmes en tête, puis les détecteurs hors ligne, puis les
batteries faibles. Jusqu'à 10 détecteurs sont listés, une légende compte les autres. Le widget se met à jour aussitôt
qu'une alarme commence ou se termine.

## Déclencheurs de scène

Les quatre peuvent être limités à un détecteur (laissez le champ vide pour tous). Leurs variables s'utilisent dans
les actions de la scène, par exemple dans un message : `{{triggerEvent.data.device_name}}`.

| Déclencheur                        | Quand                                                                                        | Variables                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Alarme incendie (fumée ou chaleur) | Un détecteur déclenche une alarme fumée ou chaleur. Filtre : cause.                          | `device_name`, `room`, `cause` (`smoke` ou `heat`) |
| Alarme CO                          | Un détecteur déclenche une alarme monoxyde de carbone.                                       | `device_name`, `room`, `co_ppm`                    |
| Fuite d'eau                        | Un détecteur de fuite détecte de l'eau.                                                      | `device_name`, `room`                              |
| Batterie faible                    | La batterie d'un détecteur devient faible (une fois par période, même après un redémarrage). | `device_name`, `room`, `battery`                   |

Une alarme qui sonne déjà au démarrage de l'intégration déclenche une fois. Les fonctionnalités ci-dessus servent
aussi directement de déclencheurs (« l'alarme fumée du détecteur de la cuisine passe à 1 »).

## Action

**Tester la connexion** (écran de configuration) : se connecte, lit le compte et liste les détecteurs trouvés.
Utilisez-la après un changement de mot de passe : un mot de passe refusé n'est pas réessayé automatiquement, pour ne
pas bloquer le compte.

Il n'y a **aucune commande** : l'intégration ne coupe, ne teste et n'arme jamais rien. Couper une alarme à distance
n'est possible que depuis l'application X-Sense, volontairement.

## Exemples de scènes

- **Incendie la nuit** : déclencheur « Alarme incendie » → allumer toutes les lumières, ouvrir les volets du chemin de
  sortie, envoyer « 🔥 Alarme incendie : {{triggerEvent.data.device_name}} ({{triggerEvent.data.room}}) » à tous les
  utilisateurs.
- **Monoxyde de carbone** : déclencheur « Alarme CO » → couper la prise connectée de la chaudière, lancer la
  ventilation, envoyer « CO {{triggerEvent.data.co_ppm}} ppm dans {{triggerEvent.data.room}} : sortez et aérez ».
- **Fuite d'eau** : déclencheur « Fuite d'eau » → fermer la vanne d'eau, envoyer un message avec la pièce.
- **Entretien** : déclencheur « Batterie faible » → envoyer « Changer la pile de {{triggerEvent.data.device_name}} ».

## Dépannage

- **« X-Sense refuse l'e-mail ou le mot de passe »** : vérifiez-les dans l'application X-Sense (déconnexion puis
  reconnexion). Les comptes créés par Google/Apple n'ont pas de mot de passe. Enregistrez ensuite de nouveau la
  configuration ou appuyez sur **Tester la connexion**.
- **« Cloud X-Sense injoignable »** : Gladys n'a pas accès à internet, ou le cloud X-Sense est en panne.
  L'intégration réessaie d'elle-même et signale son retour.
- **Un détecteur manque** : seuls les détecteurs de fumée, CO, chaleur et fuite d'eau sont listés (pas de caméras,
  claviers, détecteurs de mouvement ou d'ouverture, thermo-hygromètres). Appuyez sur **Tester la connexion**, puis
  ouvrez l'onglet Découverte.
- **« Pas de valeur récente »** sur une batterie : l'intégration republie chaque valeur au moins toutes les 6 heures ;
  si cela persiste, consultez les logs de l'intégration.
- **L'application du téléphone se déconnecte sans cesse**, ou Gladys se reconnecte sans arrêt : le même compte sert
  aux deux. Utilisez un second compte X-Sense avec les détecteurs partagés (voir Prérequis).
- Plus de détails dans les logs : mettez `LOG_LEVEL=debug` sur le conteneur de l'intégration.

## Limites

- Cloud seulement : pas d'accès local à la station de base. Sans internet, Gladys ne reçoit rien — les détecteurs
  sonnent toujours.
- Le délai des alarmes dépend du cloud X-Sense : en général quelques secondes, parfois plus.
- Lecture seule : ni coupure, ni test, ni exercice d'évacuation, ni armement depuis Gladys.
- Le niveau de CO en ppm n'est pas une fonctionnalité d'appareil (Gladys n'en a pas encore) ; le widget et le
  déclencheur CO le transmettent.
- Le texte « Dernier test » n'apparaît qu'après un test fait pendant que l'intégration tourne.
- API non officielle, étudiée par la communauté (python-xsense, intégration Home Assistant) : X-Sense peut la changer.
- _Développée sans le matériel : vos retours sont les bienvenus_ sur le dépôt GitHub.
