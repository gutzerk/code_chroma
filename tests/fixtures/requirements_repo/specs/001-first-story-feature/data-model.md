# Data Model: Shared Config Resolver

**Status**: Complete

## Fields

| Field | Type | Description |
|---|---|---|
| `path` | str | Absolute path to the config file |
| `cache_ttl` | int | Seconds before the cache entry expires |
| `strict` | bool | Raise instead of falling back to defaults |
