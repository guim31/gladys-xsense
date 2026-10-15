# X-Sense for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that brings the **X-Sense smoke,
carbon monoxide, heat and water leak detectors** into Gladys, through the X-Sense cloud (the one of the X-Sense
Home Security app): alarms, battery, online state, signal, last self-test, and the SBS50 / SBS10 base stations.

> **Developed without the hardware: feedback welcome.** The integration is built from the protocol work of
> [python-xsense](https://github.com/theosnel/python-xsense) and of the Home Assistant integration, and tested
> against a simulated X-Sense cloud — not against real detectors nor a real account. Please report what works and
> what does not in the [issues](https://github.com/guim31/gladys-xsense/issues).

> **Safety.** Gladys does not replace the sirens of the detectors and is not a monitored alarm service. Alarms go
> through the X-Sense cloud: they reach Gladys after a few seconds, and not at all without internet. Use the
> integration for extra notifications and automations, never as the only warning.

## Features

- **One device per detector** — smoke (XS01-M, XS0B-MR, XS01-WX…), CO (XC01-M, XC04-WX…), combined smoke + CO
  (XP0A-MR, SC07-WX…), heat (XH02-M), water leak (SWS51, SWS0B): the **alarm in progress** (smoke, CO, heat or water),
  the **battery** (the 4 levels X-Sense reports), **online**, the **radio or Wi-Fi signal** and the **last self-test**
  (result and date).
- **One device per base station** (SBS50, SBS10): online and Wi-Fi signal.
- **Live alarms**: the integration listens to the same push channel as the app (AWS IoT MQTT), and reads the cloud
  every 5 minutes (configurable) as a safety net.
- **Scene triggers**: _Fire alarm (smoke or heat)_, _CO alarm_ (with the CO level in ppm), _Water leak_ and _Low
  battery_ (once per low-battery period, across restarts) — each with the detector's name and room.
- **Dashboard widget** "X-Sense detectors": alarms, low batteries and offline devices at a glance, one line per
  detector, alarms first.
- **Read only**: no command at all. Silencing, testing or arming stays in the X-Sense app.
- Texts in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later, with internet access.
- An **X-Sense account** (X-Sense Home Security app) with an e-mail and a password — not a Google/Apple sign-in.
- **A second X-Sense account for Gladys** is strongly recommended: one account cannot stay signed in to the app and
  to Gladys at the same time. Share your detectors with it from your main account.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter `https://github.com/guim31/gladys-xsense` (or
   install it from the store once published).
2. In **Configuration**, fill in the e-mail and the password of the X-Sense account, then press **Test the
   connection**.
3. Open the **Discovery** tab and add the detectors and base stations.

The full documentation, in four languages, is in [`docs/`](docs/en.md): devices, widget, triggers, scene examples,
troubleshooting.

## How it works

- **Sign-in**: the X-Sense app signs in to an AWS Cognito user pool with the SRP protocol (the password never leaves
  the container). The tokens are kept in the private `/data` volume, so a restart does not sign in again.
- **Account**: homes, rooms, base stations and detectors come from the X-Sense API (every 30 minutes).
- **States**: each base station and Wi-Fi detector keeps AWS IoT "device shadows" — its last reported state. The
  integration reads them on its own timer (every 5 minutes by default; Gladys 5.2.1 does not poll external devices
  reliably, GladysAssistant/Gladys#3198) and receives their updates live over MQTT. Only the values that changed are
  sent to Gladys, plus a heartbeat every 6 hours.
- **Dependencies**: none besides the Gladys SDK. The cryptography (SRP, AWS Signature V4) uses `node:crypto`, and a
  minimal MQTT 3.1.1 client runs over Node's WebSocket.

## Limitations

- Cloud only; the alarm delay depends on the X-Sense cloud (usually a few seconds).
- Only smoke, CO, heat and water leak detectors and their base stations. Cameras, keypads, motion and door sensors,
  thermo-hygrometers, lights and mailboxes are left out.
- The CO level in ppm has no Gladys feature to display it: it is shown by the widget and carried by the CO trigger.
- The "last test" appears after a self-test made while the integration runs (the cloud only pushes it then).
- X-Sense has no public API: this uses the private API of the app, read only, and X-Sense may change it.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx github:GladysAssistant/integration-store .   # store admission checks
node scripts/probe.mjs                           # real cloud, made-up account: stops at the refusal
XSENSE_EMAIL=… XSENSE_PASSWORD=… node scripts/probe.mjs --mqtt   # real account, read only
```

The tests run the whole integration on the SDK's fake Gladys against a simulated X-Sense cloud (with a real SRP
server side). The cryptography is checked against values computed by pycognito and python-xsense. The probe prints
no secret, serial number or name.

Versions are released by the Release workflow (Actions → Release); see `CLAUDE.md` for the project rules.

## Credits

- [python-xsense](https://github.com/theosnel/python-xsense) by Theo Snelleman (MIT, as declared in its
  `setup.py`): the reverse engineering of the X-Sense API, Cognito sign-in, shadows and MQTT. Read to understand the
  protocol; this integration is a new implementation in JavaScript.
- [X-Sense Home Security for Home Assistant](https://github.com/Jarnsen/ha-xsense-component_test) by Jarnsen and
  contributors (Apache-2.0): the model map, the app version, the alarm codes and the APK 1400 notes this integration
  follows.
- Built from the official [Gladys integration template](https://github.com/GladysAssistant/integration-template-js).

## Disclaimer

This project is **not affiliated with, endorsed by or supported by X-Sense**. X-Sense is a trademark of its owner.
Use at your own risk; it never replaces the detectors' own alarms.

## License

[Apache-2.0](LICENSE)
