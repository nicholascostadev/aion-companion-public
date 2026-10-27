# Public server availability sources

Verified on 2026-10-21 from the user's Windows network with ordinary unauthenticated
HTTPS GET requests. No app-owned server, database, credentials or launcher session
is needed for the official roster and maintenance notices below.

## Conclusion

The official public notice API supports a useful **announced maintenance** checker.
A direct first-party source for live per-server availability, congestion and
character-creation locks was not established. The roster API is available during
maintenance and must never be treated as a live availability probe. An elapsed
maintenance estimate also does not prove that a server has recovered.

The reference [status page](https://aion2.gaming.tools/pt-br/server-status?region=LA)
polls its own server-side Svelte loader every 30 seconds. Its data combines current
server flags, cached last observations, derived region state, historical samples,
Steam concurrency and announcements. The browser does not expose its upstream
status URL. The loader payload is obfuscated, and an ordinary terminal GET to the
page received a Cloudflare challenge. Reproducing that loader would introduce an
unsupported website dependency rather than establish direct public game status.
No application integration with that loader is recommended.

## Official maintenance notices

The [official announcement board](https://aion2.plaync.com/en-us/board/notice/list)
uses this public JSON API:

```text
GET https://api-global-community.plaync.com/aion2_global/board/notice_en/article/search/moreArticle?isVote=true&moreSize=18&moreDirection=BEFORE&previousArticleId=0
GET https://api-global-community.plaync.com/aion2_global/board/notice_en/article/{articleId}
```

The first request returned HTTP 200 in approximately 277 ms without headers,
cookies or authentication. Pagination uses the same board's `previousArticleId`.
The response has a `contentList` array; useful fields are `id`, `title`, `summary`
and `timestamps.postedAt` / `timestamps.updatedAt` (ISO UTC). Details return
`article.contentMeta` for metadata and `article.content.content` for the HTML body.
The HTML includes table rows with `When:`, `Duration:` and `Affected Services:`.
These are human-written notices, not a documented structured maintenance schema.

The current [official maintenance notice](https://aion2.plaync.com/en-us/board/notice/view?articleId=6ad7900028c7452635072c01)
has article ID `6ad7900028c7452635072c01`. Its parsed schedule is:

```json
{
  "start_utc": "2026-10-21T06:30:00Z",
  "estimated_end_utc": "2026-10-21T12:00:00Z",
  "duration_hours": 5.5,
  "affected_services": "Game servers"
}
```

That is 03:30–09:00 in `America/Sao_Paulo`. The announcement explicitly permits
schedule changes, so do not hardcode a weekly Wednesday outage or promise recovery
at the estimate. Fetch updated article content when its `updatedAt` changes.

Observed formats in earlier official notices:

| Evidence                                                                                                           | Parsing implication                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Oct 14 maintenance](https://aion2.plaync.com/en-us/board/notice/view?articleId=6ace8dc0263e537d356d10c3)          | `23:30 PDT`, `8h30 CEST`, duration `4hours`; completed title and introductory completion text remain alongside the original schedule.                        |
| [Oct 9 temporary maintenance](https://aion2.plaync.com/en-us/board/notice/view?articleId=6ac7475738eb0528f90021b1) | `Oct 8, 23:30 PDT` omits year; duration `1.5 hours`; affected services `All services`.                                                                       |
| [Oct 7 maintenance](https://aion2.plaync.com/en-us/board/notice/view?articleId=6ac6a4c0fa34c1011d627a96)           | Base duration `3 hours 30min.` plus a separate `Duration (ASIA servers): 5 hours 30 min.`. Region-specific duration must take precedence or remain unparsed. |
| [Platform maintenance](https://aion2.plaync.com/en-us/board/notice/view?articleId=6ace5580577e8c01355dff39)        | `Account registration` is affected; it must not suppress game-event notifications.                                                                           |

Only known, validated date/time, duration and game-service formats should produce
an announced window. Malformed data, unsupported regional exceptions, transport
errors and stale observations must remain unknown. Notices may be canceled,
extended or marked completed; completion supersedes the original schedule.
Completion is evidence about that maintenance incident, not permanent live health.

No public polling quota or stability guarantee was located. A five-minute refresh,
bounded timeouts, a single in-flight request, cached unchanged details and backoff
are conservative application choices, not publisher-provided limits.

## Official server roster

The [official character page](https://aion2.plaync.com/en-us/characters/index)
requests:

```text
GET https://aion2.plaync.com/en-us/api/gameinfo/servers?lang=en-US&region=la
```

Direct GET returned HTTP 200 in approximately 608 ms. The response is:

```json
{
  "serverList": [
    { "raceId": 1, "serverId": 1401, "serverName": "Siel", "serverShortName": "SIE" },
    { "raceId": 2, "serverId": 2401, "serverName": "Israphel", "serverShortName": "ISR" }
  ]
}
```

`raceId` 1 is Elyos and 2 is Asmodian. South America uses API region `la`, distinct
from the app's `latam` identifier. **`region=latam` silently returned NA East** in
the verification request, so validate region mapping rather than forwarding app
identifiers. The official page's `_regionNameMap` confirms `nae`, `naw`, `eu`, `la`
and `as`. Map app `na-east` to `nae`, `na-west` to `naw`, `eu` to `eu`, `latam` to
`la`, and `asia` to `as`.
Do not guess a region from a repeated server name.

The verified LA roster contains 12 servers:

| Elyos ID / name | Asmodian ID / name |
| --------------- | ------------------ |
| 1401 Siel       | 2401 Israphel      |
| 1402 Nezekan    | 2402 Zikel         |
| 1403 Vaizel     | 2403 Triniel       |
| 1404 Kaisinel   | 2404 Lumiel        |
| 1405 Yustiel    | 2405 Marchutan     |
| 1406 Ariel      | 2406 Azphel        |

These rows provide identity and faction only: no live state, population or
creation-lock field exists in the verified response. The project's bundled roster
already covers these IDs; refreshing it does not add server health.

## Scope of a standalone implementation

Direct official notice polling can display the latest game maintenance schedule
and prevent reminders during a validated announced window. Game-process detection
can independently suppress reminders while the game is closed, with an explicit
user override. Keep announcement-derived state separate from confirmed live state.

A complete replica of the reference page's live statuses, 24-hour histories,
congestion, creation locks and faction population was not shown to be available
through the verified official endpoints. Population percentages on the reference
page represent game-reported congestion, not player counts. Its histories are
collected samples and cannot be reconstructed from a single current roster call.

Reduced official detail-response fixtures live in
`crates/companion-capture/data/server-status-{maintenance,completed,platform,regional}.json`.
They retain the exact HTML body, title and publication/update timestamps from the
four linked notices for parser regression coverage; they are evidence samples,
not a bundled maintenance timetable.
