# CMS sitemaps

The public `GET <apiPrefix>/cms/sitemap.xml` index links the files served by
`GET <apiPrefix>/cms/sitemaps/<name>.xml`. CMS pages, routed collections and module
contributions each supply a source. Empty sources retain one empty child.

Children contain at most 50,000 URLs and 50,000,000 uncompressed UTF-8 bytes.
The byte cap is deliberately stricter than the [sitemaps protocol's
52,428,800-byte limit](https://www.sitemaps.org/protocol.html). Sizing uses the
exact serialized XML, including the declaration, wrappers, lastmod, escaped
URLs, alternate links and x-default. A single entry too large to fit fails the
request instead of producing invalid XML.

A source that fits uses `<key>.xml`; a split source uses `<key>-1.xml`,
`<key>-2.xml`, and so on. Contributors must return entries in a deterministic
order. Child URLs stay stable for the same source entries and request origin.
Changes to content or origin can change the split boundaries and filenames.

## Generation capacity

Generation currently materializes each source's full list. Both the index and
a child request scan and serialize the full source to determine byte boundaries;
the child then renders its selected entries. Splitting does not bound request
CPU or source memory. The index also reads every other source. Avoid relying on
the Workers Free tier's 10 ms CPU allowance for sources of 50,001 entries. Use
Workers Paid with a suitable budget and verify production CPU and memory, or
pre-generate large sitemap files outside the request path. Paid defaults to 30
seconds of CPU and allows up to 300 seconds; every isolate has 128 MB of memory.
These [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
were checked on 2026-10-13. Concurrent requests and longer entries increase the
memory requirement.

The public test Worker was measured on Node 24.16.0, Postgres 17 and a Ryzen 9 7900. Each dataset had 50,001 published pages, one locale, lastmod, an en
alternate and x-default. Five uncached index/largest-child pairs ran in sequence;
`performance.now()` and `process.cpuUsage()` covered the request through full
response consumption. SQL bulk seeding, assertions and URL parsing were outside
the timed region. CPU is process user + system time, including Node, the test
harness and GC; it is **not deployed Worker CPU time**. Other desktop workloads
were active. No production CPU or memory guarantee follows from this run.

| Dataset / response            | Wall ms, median (range) | Process CPU ms, median (range) | Response bytes |
| ----------------------------- | ----------------------- | ------------------------------ | -------------- |
| Short paths / index           | 170 (162–172)           | 195 (166–200)                  | 530            |
| Short paths / largest child   | 232 (222–245)           | 275 (248–331)                  | 13,166,834     |
| Escaped paths / index         | 468 (458–474)           | 486 (481–500)                  | 530            |
| Escaped paths / largest child | 830 (821–842)           | 963 (944–1,001)                | 49,999,058     |

The escaped paths append `é&` forty times. Percent encoding, entity escaping and
the alternate links expand each entry; the byte cap splits before the URL cap.
The regression checks every served child's bytes and count and verifies the
complete expected URL set. Additional public-response tests cover one byte
below, exactly at, and one byte above the decimal cap.

To repeat the correctness checks and process measurement from the repo root:

```sh
SITEMAP_TIMINGS=1 DATABASE_URL_TEST=postgres://postgres:postgres@127.0.0.1:54317/postgres \
  pnpm exec vitest run fixtures/host/test/cms/sitemap-split.test.ts --disableConsoleIntercept
```
