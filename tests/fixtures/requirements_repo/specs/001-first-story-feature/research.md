# Research: Shared Config Resolver

**Status**: Complete

## Decisions

- **Caching strategy**: process-wide, invalidated on config file change
- **Fallback order**: env override, then file, then defaults
