import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' })
const root = process.cwd()
const stage = join(root, 'dist', 'dsh-personal-media-studio')
rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
for (const name of ['package.json', 'package-lock.json', 'cordis.patch.yml', 'icon.svg', 'README.md', 'lib', 'brand', 'locale']) {
  cpSync(join(root, name), join(stage, name), { recursive: true })
}
const archive = join(root, 'dist', 'dsh-personal-media-studio.zip')
rmSync(archive, { force: true })
execFileSync('zip', ['-r', archive, 'dsh-personal-media-studio'], { cwd: join(root, 'dist'), stdio: 'inherit' })
console.log(archive)
