# Raw Event channel isolation

`isolateRawEventChannels` permits `provenance.evidence_kind=raw_event` only in `raw_event_fallback` and excludes it from assertion vector, assertion FTS, and subject attachment. Non-raw evidence is excluded from the raw lane. Trace records eligible and excluded channels.

Static and integration tests prove that a raw event cannot obtain repeated RRF contributions through ordinary assertion channels.
