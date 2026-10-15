# X-Sense

> **Safety first.** Gladys does **not** replace the sirens of your detectors, and it is not a monitored alarm
> service. The alarms go through the X-Sense cloud: they reach Gladys after **a few seconds** (sometimes more), and
> not at all when your internet access, the X-Sense cloud or Gladys is down. Use this integration to add
> notifications and automations (lights on, heating off, a message to a neighbour), never as your only warning.

## Overview

This integration brings the **X-Sense smoke, carbon monoxide (CO), heat and water leak detectors** into Gladys,
through the X-Sense cloud — the one the **X-Sense Home Security** app uses:

- one Gladys device per detector: **alarm in progress**, **battery**, **online**, **radio or Wi-Fi signal** and
  **last self-test**;
- one Gladys device per **base station** (SBS50, SBS10): **online** and **Wi-Fi signal**;
- **scene triggers**: fire alarm, CO alarm, water leak and low battery, with the detector's name and room;
- a **dashboard widget** listing every detector, alarms first.

The alarms arrive **live** (the same push channel as the app), and the integration also reads the cloud every few
minutes as a safety net.

_Developed without the hardware: feedback welcome._ This integration is **not affiliated with X-Sense**; X-Sense is
a trademark of its owner.

## Requirements

- X-Sense detectors linked to an **X-Sense account** in the X-Sense Home Security app: RF detectors paired to an
  **SBS50** (or SBS10) base station, or Wi-Fi detectors (XS01-WX, XC04-WX, SC07-WX…).
- The e-mail and password of that account. Accounts created with "Sign in with Google/Apple" have no password: create
  a regular account.
- **A second X-Sense account for Gladys** (strongly recommended): one account cannot stay signed in to the app and
  to Gladys at the same time, each would keep signing the other out. Create a second account in the app, then share
  your detectors with it from your main account (the same advice as the Home Assistant integration).
- Gladys **5.1.0** or later, with internet access.

## Configuration

In Gladys, **Integrations → X-Sense → Configuration**:

| Field                     | Description                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E-mail                    | E-mail of the X-Sense account.                                                                                                                                           |
| Password                  | Its password. Stored by Gladys; the integration keeps only the session tokens in its private `/data` volume.                                                             |
| Feature names language    | Language of the feature names of a **new** device (Gladys keeps the name of a feature once created) and of the self-test results. French by default.                     |
| Cloud read interval (min) | Minutes between two full reads of the cloud (1 to 60, 5 by default). The alarms do not wait for it: they arrive live. This read refreshes the battery and signal levels. |

Save, then press **Test the connection**: the result lists the detectors found. Open the **Discovery** tab and add
the devices you want.

**Quotas and conditions of use.** X-Sense publishes no public API: the integration uses the private API of the app,
like the Home Assistant integration does, read only. To stay light on the X-Sense servers it reads the list of
devices every 30 minutes, the state of each base station at the interval above (5 minutes by default, the pace of the
Home Assistant integration), and keeps one live connection per account. Never set the interval below what you need.
X-Sense may change or close this API at any time.

## Devices

**Detector** (one per smoke, CO, combined, heat or water detector):

| Feature      | Values                                                                                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Smoke alarm  | 1 when the detector is in smoke alarm (smoke and combined detectors).                                                                                                                              |
| CO alarm     | 1 when the detector is in carbon monoxide alarm (CO and combined detectors).                                                                                                                       |
| Heat alarm   | 1 when the heat detector is in alarm. Shown as a smoke sensor: Gladys has no heat category, it is a fire alarm.                                                                                    |
| Water leak   | 1 when the water leak detector detects water.                                                                                                                                                      |
| Battery      | Battery in %. X-Sense reports 4 levels only: 0, 33, 67 or 100 %. 33 % and below is "low".                                                                                                          |
| Online       | 1 when the detector talks to its base station (or to the cloud for a Wi-Fi detector).                                                                                                              |
| Radio signal | RF detectors: 0 to 3 bars towards the base station.                                                                                                                                                |
| Wi-Fi signal | Wi-Fi detectors: signal in dBm (-100 to -40).                                                                                                                                                      |
| Last test    | Result and date of the last self-test (button pressed on the detector or test from the app), e.g. "Passed · 12/10/2026 10:03". Empty until a first test after the installation of the integration. |

**Base station** (SBS50, SBS10): **Online** and **Wi-Fi signal** (dBm).

Everything is read only. The CO level in ppm, when the detector reports it, is shown by the widget and carried by the
"CO alarm" trigger (Gladys has no CO-level feature to display it).

## Widget

**X-Sense detectors**: three tiles (detectors in alarm, low batteries, offline devices) and one line per detector —
name, room, state and battery — with the alarms first, then the offline detectors, then the low batteries. Up to 10
detectors are listed, a caption counts the others. The widget refreshes at once when an alarm starts or ends.

## Scene triggers

All four can be limited to one detector (leave the field empty for all detectors). Their variables can be used in
the actions of the scene, e.g. in a message: `{{triggerEvent.data.device_name}}`.

| Trigger                    | When                                                                                  | Variables                                          |
| -------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Fire alarm (smoke or heat) | A detector starts a smoke or heat alarm. Filter: cause.                               | `device_name`, `room`, `cause` (`smoke` or `heat`) |
| CO alarm                   | A detector starts a carbon monoxide alarm.                                            | `device_name`, `room`, `co_ppm`                    |
| Water leak                 | A water leak detector detects water.                                                  | `device_name`, `room`                              |
| Low battery                | A detector's battery becomes low (once per low-battery period, also after a restart). | `device_name`, `room`, `battery`                   |

An alarm already sounding when the integration starts fires its trigger once. The device features above can also be
used directly as scene triggers ("the smoke alarm of the kitchen detector becomes 1").

## Action

**Test the connection** (Configuration screen): signs in, reads the account and lists the detectors found. Use it
after changing the password: a refused password is not retried automatically, so that the account is not locked.

There is **no command**: the integration never silences, tests or arms anything. Silencing an alarm remotely is only
possible from the X-Sense app, on purpose.

## Scene examples

- **Fire at night**: trigger "Fire alarm" → turn on every light, open the shutters of the escape route, send
  "🔥 Fire alarm: {{triggerEvent.data.device_name}} ({{triggerEvent.data.room}})" to every user.
- **Carbon monoxide**: trigger "CO alarm" → switch off the boiler's smart plug, turn on the ventilation, send
  "CO {{triggerEvent.data.co_ppm}} ppm in {{triggerEvent.data.room}}: get out and ventilate".
- **Water leak**: trigger "Water leak" → close the water valve, send a message with the room.
- **Maintenance**: trigger "Low battery" → send "Change the battery of {{triggerEvent.data.device_name}}".

## Troubleshooting

- **"X-Sense refused the e-mail or the password"**: check them in the X-Sense app (sign out and back in). Accounts
  created with Google/Apple sign-in have no password. Then save the configuration again or press **Test the
  connection**.
- **"X-Sense cloud unreachable"**: Gladys has no internet access, or the X-Sense cloud is down. The integration
  retries on its own and says when it is back.
- **A detector is missing**: only smoke, CO, heat and water leak detectors are listed (no cameras, keypads, motion or
  door sensors, thermo-hygrometers). Press **Test the connection**, then the Discovery tab.
- **"No recent value"** on a battery: the integration republishes every value at least every 6 hours; if it stays,
  check the logs of the integration.
- **The phone app keeps signing out**, or Gladys keeps reconnecting: the same account is used by both. Use a second
  X-Sense account with the detectors shared (see Requirements).
- More details in the logs: set `LOG_LEVEL=debug` on the integration container.

## Limitations

- Cloud only: no local access to the base station. Without internet, Gladys receives nothing — the detectors still
  sound.
- The alarm delay depends on the X-Sense cloud: usually a few seconds, sometimes more.
- Read only: no silencing, no test, no fire drill, no arming from Gladys.
- The CO level in ppm is not a device feature (Gladys has no such feature yet); the widget and the CO trigger carry it.
- The "Last test" text only appears after a test made while the integration runs.
- Unofficial API, studied by the community (python-xsense, Home Assistant integration): X-Sense may change it.
- _Developed without the hardware: feedback welcome_ on the GitHub repository.
