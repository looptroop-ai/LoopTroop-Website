import { cp, copyFile, mkdir, rm, readdir } from 'node:fs/promises'
import path from 'node:path'
import { execSync } from 'node:child_process'

const root = process.cwd()
const siteDir = path.join(root, 'site')
const docsDistDir = path.join(root, 'docs/.vitepress/dist')

console.log('Cleaning site directory...')
await rm(siteDir, { recursive: true, force: true })
await mkdir(path.join(siteDir, 'docs'), { recursive: true })

console.log('Copying marketing page...')
await copyFile(path.join(root, 'web.html'), path.join(siteDir, 'index.html'))

console.log('Copying public files...')
await cp(path.join(root, 'public'), siteDir, { recursive: true })

console.log('Compiling Tailwind CSS for landing page...')
execSync('tailwindcss -i src/web.css -o site/web.css --minify', { stdio: 'inherit' })

console.log('Copying WebP screenshots to site/media...')
const mediaDest = path.join(siteDir, 'media')
await mkdir(mediaDest, { recursive: true })
const mediaSrc = path.join(root, 'docs', 'media')
const mediaFiles = await readdir(mediaSrc)
await Promise.all(
  mediaFiles
    .filter((file) => file.endsWith('.webp') || file.endsWith('.gif'))
    .map((file) => copyFile(path.join(mediaSrc, file), path.join(mediaDest, file)))
)

console.log('Copying documentation site...')
await cp(docsDistDir, path.join(siteDir, 'docs'), { recursive: true })

// Keep legacy screenshot links working for older cached marketing pages.
console.log('Copying legacy assets...')
await cp(path.join(docsDistDir, 'assets'), path.join(siteDir, 'assets'), { recursive: true })

console.log('Build completed successfully.')
