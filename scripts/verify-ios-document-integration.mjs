#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const appFlag = process.argv.indexOf('--app')
if (appFlag < 0 || process.argv[appFlag + 1] === undefined) {
  throw new Error('Usage: node scripts/verify-ios-document-integration.mjs --app /path/to/SimpleMark.app')
}

const app = resolve(process.argv[appFlag + 1])
const plist = (path) => JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', path], { encoding: 'utf8' }))
const expect = (condition, message) => {
  if (!condition) throw new Error(message)
}
const appInfoPath = `${app}/Info.plist`
expect(existsSync(appInfoPath), `No app bundle exists at ${app}`)

const appInfo = plist(appInfoPath)
const markdown = appInfo.CFBundleDocumentTypes?.find((type) =>
  Array.isArray(type.CFBundleTypeExtensions) && type.CFBundleTypeExtensions.includes('md'),
)
expect(markdown?.CFBundleTypeRole === 'Editor', 'SimpleMark must declare Markdown as an Editor')
expect(markdown?.LSHandlerRank === 'Owner', 'SimpleMark must declare Markdown handler rank Owner')
expect(markdown?.LSItemContentTypes?.includes('net.daringfireball.markdown'), 'SimpleMark must declare the Markdown UTI')
const exportedMarkdown = appInfo.UTExportedTypeDeclarations?.find((type) => type.UTTypeIdentifier === 'net.daringfireball.markdown')
expect(exportedMarkdown?.UTTypeConformsTo?.includes('public.plain-text'), 'SimpleMark must export Markdown as plain text')
expect(exportedMarkdown?.UTTypeTagSpecification?.['public.filename-extension']?.includes('md'), 'SimpleMark must export the .md filename extension')
expect(exportedMarkdown?.UTTypeTagSpecification?.['public.filename-extension']?.includes('markdown'), 'SimpleMark must export the .markdown filename extension')
expect(appInfo.LSSupportsOpeningDocumentsInPlace === true, 'SimpleMark must open documents in place')

const shareInfo = plist(`${app}/PlugIns/SimpleMarkShare.appex/Info.plist`)
const share = shareInfo.NSExtension
expect(share?.NSExtensionPointIdentifier === 'com.apple.share-services', 'Share extension point is missing')
expect(share?.NSExtensionAttributes?.NSExtensionActivationRule?.NSExtensionActivationSupportsText === 1, 'Share extension must accept plain text')

const quickLookInfo = plist(`${app}/PlugIns/SimpleMarkQuickLook.appex/Info.plist`)
const quickLook = quickLookInfo.NSExtension
expect(quickLook?.NSExtensionPointIdentifier === 'com.apple.quicklook.preview', 'Quick Look extension point is missing')
expect(quickLook?.NSExtensionAttributes?.QLSupportedContentTypes?.includes('net.daringfireball.markdown'), 'Quick Look must declare Markdown')

console.log('iOS document integration bundle verification passed')
