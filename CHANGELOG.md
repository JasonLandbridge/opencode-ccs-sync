# Changelog

## [1.0.1](https://github.com/JasonLandbridge/opencode-ccs-sync/compare/v1.0.0...v1.0.1) (2026-04-06)


### Bug Fixes

* **sync:** clear stale providers and cap retries when CLIProxy unavailable on startup ([24576b0](https://github.com/JasonLandbridge/opencode-ccs-sync/commit/24576b0feba52fb754eb945e22c2257275219039))

## 1.0.0 (2026-04-05)


### Features

* add OpenCode CCS sync plugin ([ce79ff2](https://github.com/JasonLandbridge/opencode-ccs-sync/commit/ce79ff2b0f62d3b58c088b9aeabeb5a90c793da8))
* **sync:** add provider protocol detection (SSE/JSON) with in-memory caching ([2b4318c](https://github.com/JasonLandbridge/opencode-ccs-sync/commit/2b4318c779aff4da6f9e3f34bf74b58fea210559))
* **sync:** wire protocol detection into buildProviderConfig for per-provider SDK selection ([af21800](https://github.com/JasonLandbridge/opencode-ccs-sync/commit/af218002ce4b4c815ece368341e3f787b17d3804))


### Bug Fixes

* **sync:** align OpenCode config with live CCS settings ([de62480](https://github.com/JasonLandbridge/opencode-ccs-sync/commit/de624804937ff0d8d4af7d2133f5c3dc92684d8a))
* **sync:** use ANTHROPIC_BASE_URL from settings file verbatim as provider baseURL ([bab4793](https://github.com/JasonLandbridge/opencode-ccs-sync/commit/bab47938ea6bdcae49e6965806fdd20eafdc9cf2))
* **vcs:** remove unnecessary Git mapping for my-module directory ([31df0d7](https://github.com/JasonLandbridge/opencode-ccs-sync/commit/31df0d7cf09170599ada08815010ae3d2913e875))
* **watch:** resync on live CCS settings changes ([0bb474d](https://github.com/JasonLandbridge/opencode-ccs-sync/commit/0bb474dbdf2d7a73ca16728cf63d6180f1c0d44a))

## Changelog

All notable changes to this project will be documented here by Release Please.
