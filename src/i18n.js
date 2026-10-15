// -----------------------------------------------------------------------------
// Every text the integration shows, in the four languages of the Gladys
// interface (en, fr, de, es). German says "du", Spanish says "usted", like the
// rest of guim31's integrations; the vocabulary follows the Gladys interface.
//
//   - NAMES    : the feature names, in the language chosen in the config
//                (Gladys keeps a feature's name from its creation);
//   - TEXT     : fixed texts (widget, connection status, action results);
//   - MESSAGES : texts built from a value;
//   - thrown() : a THROWN message reaches the screen as a plain string, the
//                core cannot localize it: the languages are joined.
//
// test/i18n.test.js checks that every entry carries exactly the four languages.
// -----------------------------------------------------------------------------

import { LANGUAGES } from './config.js';

/** Feature names, by language then feature key. */
export const NAMES = {
  en: {
    smoke: 'Smoke alarm',
    co: 'CO alarm',
    heat: 'Heat alarm',
    water: 'Water leak',
    battery: 'Battery',
    online: 'Online',
    rf_signal: 'Radio signal',
    wifi_signal: 'Wi-Fi signal',
    last_test: 'Last test',
  },
  fr: {
    smoke: 'Alarme fumée',
    co: 'Alarme CO',
    heat: 'Alarme chaleur',
    water: "Fuite d'eau",
    battery: 'Batterie',
    online: 'En ligne',
    rf_signal: 'Signal radio',
    wifi_signal: 'Signal Wi-Fi',
    last_test: 'Dernier test',
  },
  de: {
    smoke: 'Rauchalarm',
    co: 'CO-Alarm',
    heat: 'Hitzealarm',
    water: 'Wasserleck',
    battery: 'Batterie',
    online: 'Online',
    rf_signal: 'Funksignal',
    wifi_signal: 'WLAN-Signal',
    last_test: 'Letzter Test',
  },
  es: {
    smoke: 'Alarma de humo',
    co: 'Alarma de CO',
    heat: 'Alarma de calor',
    water: 'Fuga de agua',
    battery: 'Batería',
    online: 'En línea',
    rf_signal: 'Señal de radio',
    wifi_signal: 'Señal Wi-Fi',
    last_test: 'Última prueba',
  },
};

/** Fixed texts. */
export const TEXT = {
  // Widget
  alarms: { en: 'Alarms', fr: 'Alarmes', de: 'Alarme', es: 'Alarmas' },
  lowBattery: {
    en: 'Low battery',
    fr: 'Batterie faible',
    de: 'Batterie schwach',
    es: 'Batería baja',
  },
  offline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  ok: { en: 'OK', fr: 'OK', de: 'OK', es: 'OK' },
  smoke: { en: 'SMOKE', fr: 'FUMÉE', de: 'RAUCH', es: 'HUMO' },
  co: { en: 'CO', fr: 'CO', de: 'CO', es: 'CO' },
  heat: { en: 'HEAT', fr: 'CHALEUR', de: 'HITZE', es: 'CALOR' },
  water: { en: 'LEAK', fr: 'FUITE', de: 'LECK', es: 'FUGA' },
  endOfLife: { en: 'End of life', fr: 'Fin de vie', de: 'Lebensende', es: 'Fin de vida útil' },
  noData: {
    en: 'No data yet',
    fr: 'Pas encore de données',
    de: 'Noch keine Daten',
    es: 'Aún sin datos',
  },
  noDetector: {
    en: 'No detector found on the X-Sense account.',
    fr: 'Aucun détecteur trouvé sur le compte X-Sense.',
    de: 'Kein Melder im X-Sense-Konto gefunden.',
    es: 'No se ha encontrado ningún detector en la cuenta X-Sense.',
  },
  notConfigured: {
    en: 'Fill in the e-mail and password of the X-Sense account in the configuration.',
    fr: "Renseignez l'e-mail et le mot de passe du compte X-Sense dans la configuration.",
    de: 'Gib die E-Mail-Adresse und das Passwort des X-Sense-Kontos in der Konfiguration ein.',
    es: 'Introduzca el correo electrónico y la contraseña de la cuenta X-Sense en la configuración.',
  },
  notConnected: {
    en: 'Not connected to the X-Sense cloud, see the Configuration screen.',
    fr: 'Pas de connexion au cloud X-Sense, voir l’écran de configuration.',
    de: 'Keine Verbindung zur X-Sense-Cloud, sieh dir die Konfiguration an.',
    es: 'Sin conexión con la nube de X-Sense, consulte la pantalla de configuración.',
  },
  // Self-test results, then " · <date>"
  testPassed: { en: 'Passed', fr: 'Réussi', de: 'Bestanden', es: 'Superada' },
  testFailed: { en: 'Failed', fr: 'Échoué', de: 'Fehlgeschlagen', es: 'Fallida' },

  // Configuration screen
  notConfiguredStatus: {
    en: 'Fill in the e-mail and password of the X-Sense account.',
    fr: "Renseignez l'e-mail et le mot de passe du compte X-Sense.",
    de: 'Gib die E-Mail-Adresse und das Passwort des X-Sense-Kontos ein.',
    es: 'Introduzca el correo electrónico y la contraseña de la cuenta X-Sense.',
  },
  wrongCredentials: {
    en: 'X-Sense refused the e-mail or the password: check them (the account of the X-Sense Home Security app).',
    fr: "X-Sense refuse l'e-mail ou le mot de passe : vérifiez-les (compte de l'application X-Sense Home Security).",
    de: 'X-Sense lehnt die E-Mail-Adresse oder das Passwort ab: prüfe sie (Konto der App X-Sense Home Security).',
    es: 'X-Sense rechaza el correo o la contraseña: compruébelos (cuenta de la aplicación X-Sense Home Security).',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
    de: 'Die Initialisierung ist fehlgeschlagen, sieh dir die Logs der Integration an.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
};

/** Texts built from a value. Each one returns the four languages. */
export const MESSAGES = {
  unreachable: (reason) => ({
    en: `X-Sense cloud unreachable (${reason}). Retrying.`,
    fr: `Cloud X-Sense injoignable (${reason}). Nouvel essai en cours.`,
    de: `X-Sense-Cloud nicht erreichbar (${reason}). Neuer Versuch läuft.`,
    es: `Nube de X-Sense inaccesible (${reason}). Reintentando.`,
  }),
  connected: (detectors, stations) => ({
    en: `Connected: ${detectors} detector(s), ${stations} base station(s).`,
    fr: `Connecté : ${detectors} détecteur(s), ${stations} station(s) de base.`,
    de: `Verbunden: ${detectors} Melder, ${stations} Basisstation(en).`,
    es: `Conectado: ${detectors} detector(es), ${stations} estación(es) base.`,
  }),
  // The test action, one line per detector found.
  testResult: (detectors, stations, lines) => ({
    en: `Connection OK: ${detectors} detector(s), ${stations} base station(s). ${lines}`.trim(),
    fr: `Connexion OK : ${detectors} détecteur(s), ${stations} station(s) de base. ${lines}`.trim(),
    de: `Verbindung OK: ${detectors} Melder, ${stations} Basisstation(en). ${lines}`.trim(),
    es: `Conexión OK: ${detectors} detector(es), ${stations} estación(es) base. ${lines}`.trim(),
  }),
  more: (count) => ({
    en: `+ ${count} more detector(s)`,
    fr: `+ ${count} autre(s) détecteur(s)`,
    de: `+ ${count} weitere(r) Melder`,
    es: `+ ${count} detector(es) más`,
  }),
};

/**
 * A message to THROW: the core shows a thrown message as a plain string, so
 * the four languages are joined.
 * @param {{ en: string, fr: string, de: string, es: string }} text
 */
export function thrown(text) {
  return LANGUAGES.map((lang) => text[lang]).join(' / ');
}

/** One language of a multi-language text, English as the fallback. */
export const pick = (text, language) => text[language] ?? text.en;
