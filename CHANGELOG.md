# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-15

### Added

- X-Sense smoke, carbon monoxide, heat and water leak detectors in Gladys, through
  the X-Sense cloud: one device per detector with its alarm in progress, battery,
  online state, radio or Wi-Fi signal and last self-test, and one device per
  SBS50 / SBS10 base station with its online state and Wi-Fi signal.
- Live alarms over the X-Sense push channel, and a full read of the cloud every 5
  minutes (1 to 60, configurable) as a safety net.
- Scene triggers: fire alarm (smoke or heat), CO alarm (with the CO level), water
  leak, and low battery (once per low-battery period), each with the detector's
  name and room.
- Dashboard widget "X-Sense detectors": alarms, low batteries and offline devices,
  one line per detector, alarms first.
- "Test the connection" button, which lists the detectors found.
- English, French, German and Spanish texts and documentation.

[Unreleased]: https://github.com/guim31/gladys-xsense/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-xsense/releases/tag/v1.0.1
