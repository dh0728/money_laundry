import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const sourceDirectory = process.argv[2]
if (!sourceDirectory) throw new Error('Usage: pnpm tokens:sync <v3 asset directory>')
const destination = resolve(import.meta.dirname, '../src/styles')
await mkdir(destination, { recursive: true })
const hashes = {}
for (const file of ['tokens.css', 'tokens.json']) {
  const source = resolve(sourceDirectory, file)
  hashes[file] = createHash('sha256').update(await readFile(source)).digest('hex')
  await copyFile(source, resolve(destination, file))
}
await writeFile(resolve(destination, 'tokens-source.json'), JSON.stringify({
  source: 'https://github.com/kmg200164/second-brain/tree/main/projects/aml-radar/assets/design-system-zero-base',
  mode: 'Copied snapshot; run tokens:sync explicitly to update.',
  sha256: hashes,
}, null, 2) + '\n')
console.log('Copied v3 tokens.css and tokens.json without transforming values.')
