export const refusedLocale = (message: string, locales: ReadonlyArray<string>) =>
  [
    ...message.matchAll(
      /\["([^"]*)"\]|\b(?:[Tt]he|a) ([\w-]+) (?:path|social image)\b|\bin ([\w-]+)\.(?=\s|$)/g,
    ),
  ]
    .flatMap(([, segment, named, required]) => [segment, named, required])
    .find((code) => code !== undefined && locales.includes(code))
