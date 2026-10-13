# @opulonjs/cms

## Sitemap limits

The public `GET <apiPrefix>/cms/sitemap.xml` index links the files served by
`GET <apiPrefix>/cms/sitemaps/<name>.xml`. CMS pages, routed collections and module
contributions each supply a source. Empty sources retain one empty child.

Children contain at most 50,000 URLs and 10,000,000 uncompressed UTF-8 bytes.
The byte cap is below the [sitemaps protocol's
52,428,800-byte maximum](https://www.sitemaps.org/protocol.html) to leave memory
for source rows, serialization and response encoding within a Worker's 128 MB
isolate limit. Sizing counts the exact XML declaration, wrappers, lastmod,
escaped URLs, alternate links and x-default. A single entry too large to fit
fails the request instead of producing invalid XML.

Generation materializes each source's full list. Both the index and a child
request scan and serialize the full source to determine boundaries; the child
then renders its selected entries. The cap bounds child output, not source
memory or request CPU. Avoid relying on the Workers Free tier's 10 ms CPU
allowance for large sources. Use Workers Paid with a suitable budget and verify
production CPU and memory, or pre-generate large sitemap files outside the
request path. Paid defaults to 30 seconds of CPU and allows up to 300 seconds;
every isolate has 128 MB of memory. These [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
were checked on 2026-10-13. Concurrent requests and longer entries increase the
memory requirement.

## Child naming

A source that fits uses `<key>.xml`; a split source uses `<key>-1.xml`,
`<key>-2.xml`, and so on. Contributors must return entries in deterministic order.
Child URLs stay stable for the same source entries and request origin. Changes
to content or origin can change the split boundaries and filenames.
