/**
 * The content locale a refused save names, read from the server's message (`CmsInvalid` carries
 * only a message): a value's path (`… at ["title"]["it"]`), a path or social image of one locale
 * ("The it path …", "… needs a it path"), or a value required in one ("… is required in en.",
 * "… needs a label in en."). Undefined when it names none of `locales`.
 */
export const refusedLocale = (message: string, locales: ReadonlyArray<string>) =>
  [
    ...message.matchAll(
      /\["([^"]*)"\]|\b(?:[Tt]he|a) ([\w-]+) (?:path|social image)\b|\bin ([\w-]+)\.(?=\s|$)/g,
    ),
  ]
    .flatMap(([, segment, named, required]) => [segment, named, required])
    .find((code) => code !== undefined && locales.includes(code))
