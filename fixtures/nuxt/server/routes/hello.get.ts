// A server route answering per visitor through H3's `send`, with no Cache-Control of its own:
// cmsNitroPlugin's default must keep it out of Workers Cache.
export default defineEventHandler((event) =>
  send(event, `Hello ${getCookie(event, 'name') ?? 'guest'}`, 'text/plain'),
)
