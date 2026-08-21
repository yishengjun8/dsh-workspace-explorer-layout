import { Buffer } from 'node:buffer'
import { createHash, randomBytes } from 'node:crypto'
import { lstat, mkdir, open, readdir, realpath, rename, stat, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import z from '@deepseek-ai/schemastery'
import iconv from 'iconv-lite'

/** Stable Cordis plugin name. */
export const name = 'workspace-explorer-layout'

/** Host services required by the workspace browser route. */
export const inject = ['webServer', 'workspaceRegistry', 'webRuntime', 'sessions']

/** Host-side limits. All bounds are deployment-configurable in cordis.patch.yml. */
export const Config = z.object({
  maxEntriesPerDirectory: z.natural().min(1).max(10_000).default(1000),
  maxPreviewBytes: z.natural().min(1024).max(10 * 1024 * 1024).default(1024 * 1024),
  maxContextBytes: z.natural().min(1024).max(1024 * 1024).default(64 * 1024),
  maxPromptContextBytes: z.natural().min(4096).max(2 * 1024 * 1024).default(68 * 1024),
  maxContextSourceBytes: z.natural().min(1024).max(100 * 1024 * 1024).default(10 * 1024 * 1024),
  enableEditing: z.boolean().default(false),
  maxEditableBytes: z.natural().min(1024).max(10 * 1024 * 1024).default(1024 * 1024),
  maxEntryNameBytes: z.natural().min(1).max(1024).default(255),
  maxMutationBodyBytes: z.natural().min(128).max(64 * 1024).default(4096),
  searchExcludeDirs: z.array(z.string()).default(['.git', 'node_modules']),
  maxSearchFileBytes: z.natural().min(1024).max(64 * 1024 * 1024).default(1024 * 1024),
  maxSearchFiles: z.natural().min(1).max(10_000).default(10_000),
  maxSearchMatches: z.natural().min(1).max(100_000).default(2000),
  maxMatchesPerFile: z.natural().min(1).max(10_000).default(100),
  searchConcurrency: z.natural().min(1).max(64).default(16),
  maxSearchQueryLength: z.natural().min(1).max(4096).default(1024),
})

const API_PREFIX = '/workspace-explorer-layout/api'
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'cross-origin-resource-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
}
class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

function header(headers, name) {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

function parseAuthority(authority) {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

function canonicalAuthority(authority, parsed) {
  const port = parsed.port !== '' ? parsed.port : new URL(`https://${authority}`).port
  return port === '' ? parsed.hostname : `${parsed.hostname}:${port}`
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === '[::1]'
    || normalized === '::1'
    || /^127(?:\.[0-9]{1,3}){3}$/.test(normalized)
}

function isTrustedAuthority(hostUrl, trustedHosts) {
  return trustedHosts.some((entry) => {
    const parsed = parseAuthority(entry)
    if (parsed === undefined) return false
    return canonicalAuthority(entry, parsed) === parsed.hostname
      ? parsed.hostname === hostUrl.hostname
      : parsed.host === hostUrl.host
  })
}

/** Apply the same Host/Origin/Fetch-Metadata fence used by the built-in /api route. */
function isTrustedRequest(req, trustedHosts) {
  const host = header(req.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
  if (header(req.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(req.headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function sendJson(req, res, status, value, extraHeaders = {}) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')
  res.writeHead(status, {
    ...JSON_HEADERS,
    'content-length': String(body.byteLength),
    ...extraHeaders,
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}

function sendError(req, res, status, code, message, extraHeaders) {
  sendJson(req, res, status, { error: { code, message } }, extraHeaders)
}

function requiredQuery(url, name) {
  const value = url.searchParams.get(name)
  if (value === null || value === '') throw new HttpError(400, 'invalid-request', `缺少查询参数 ${name}`)
  return value
}

function normalizeRelativePath(value) {
  if (value === '') return ''
  if (/\u0000|[\u0001-\u001f\u007f\u2028\u2029]/u.test(value)
    || value.includes('\\') || value.startsWith('/') || isAbsolute(value)) {
    throw new HttpError(400, 'invalid-path', '文件路径必须是工作区内的相对路径')
  }
  const parts = value.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) {
    throw new HttpError(400, 'invalid-path', '文件路径包含无效段')
  }
  return parts.join('/')
}

function isInside(root, target) {
  const tail = relative(root, target)
  return tail === '' || (tail !== '..' && !tail.startsWith(`..${sep}`) && !isAbsolute(tail))
}

async function resolveWorkspacePath(root, relativePath) {
  const candidate = relativePath === '' ? root : resolve(root, ...relativePath.split('/'))
  let target
  try {
    target = await realpath(candidate)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') throw new HttpError(404, 'path-not-found', '文件或目录不存在')
    throw error
  }
  if (!isInside(root, target)) throw new HttpError(403, 'path-outside-workspace', '拒绝访问工作区之外的路径')
  return target
}

function entryPath(parent, name) {
  return parent === '' ? name : `${parent}/${name}`
}

function parentPath(path) {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

function normalizeEntryName(value, maxEntryNameBytes) {
  if (typeof value !== 'string') throw new HttpError(400, 'invalid-path', '文件名必须是工作区内的单个名称')
  const name = value.trim()
  if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\')
    || /\u0000|[\u0001-\u001f\u007f\u2028\u2029]/u.test(name)) {
    throw new HttpError(400, 'invalid-path', '文件名必须是工作区内的单个名称')
  }
  if (Buffer.byteLength(name, 'utf8') > maxEntryNameBytes) {
    throw new HttpError(413, 'entry-name-too-large', `文件名不能超过 ${maxEntryNameBytes} 字节`)
  }
  return name
}

async function describeEntry(root, directory, parent, dirent) {
  const base = { name: dirent.name, path: entryPath(parent, dirent.name), symlink: dirent.isSymbolicLink() }
  if (dirent.isDirectory()) return { ...base, kind: 'directory' }
  if (dirent.isFile()) return { ...base, kind: 'file' }
  if (!dirent.isSymbolicLink()) return { ...base, kind: 'other' }
  try {
    const linked = await realpath(resolve(directory, dirent.name))
    if (!isInside(root, linked)) return { ...base, kind: 'blocked' }
    const linkedStat = await stat(linked)
    if (linkedStat.isDirectory()) return { ...base, kind: 'directory' }
    if (linkedStat.isFile()) return { ...base, kind: 'file' }
    return { ...base, kind: 'other' }
  } catch {
    return { ...base, kind: 'blocked' }
  }
}

function compareEntries(left, right) {
  const rank = { directory: 0, file: 1, other: 2, blocked: 3 }
  const byKind = rank[left.kind] - rank[right.kind]
  return byKind || left.name.localeCompare(right.name, 'en', { numeric: true, sensitivity: 'base' })
}

function describeCreatedEntry(workspace, relativePath, kind) {
  return {
    workspaceId: String(workspace.id),
    path: relativePath,
    name: relativePath.slice(relativePath.lastIndexOf('/') + 1),
    kind,
    symlink: false,
  }
}

async function listTree(workspace, relativePath, maxEntriesPerDirectory) {
  const root = await realpath(workspace.path)
  const directory = await resolveWorkspacePath(root, relativePath)
  const directoryStat = await stat(directory)
  if (!directoryStat.isDirectory()) throw new HttpError(400, 'not-a-directory', '所选路径不是目录')
  const raw = await readdir(directory, { withFileTypes: true })
  const entries = await Promise.all(raw.map(dirent => describeEntry(root, directory, relativePath, dirent)))
  entries.sort(compareEntries)
  const truncated = entries.length > maxEntriesPerDirectory
  return {
    workspaceId: String(workspace.id),
    path: relativePath,
    entries: entries.slice(0, maxEntriesPerDirectory),
    truncated,
  }
}

const SEARCH_WINDOW_BEFORE = 120
const SEARCH_WINDOW_AFTER = 240

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Literal substring search over one decoded file window, one entry per match. */
function findMatches(content, query, caseSensitive, cap) {
  let re
  try {
    re = new RegExp(escapeRegExp(query), caseSensitive ? 'g' : 'gi')
  } catch {
    return []
  }
  const results = []
  const lines = content.split('\n')
  for (let lineIndex = 0; lineIndex < lines.length && results.length < cap; lineIndex += 1) {
    const raw = lines[lineIndex]
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    re.lastIndex = 0
    let match
    while (results.length < cap && (match = re.exec(text)) !== null) {
      const start = match.index
      const length = match[0].length
      const trimmed = text.length > SEARCH_WINDOW_BEFORE + length + SEARCH_WINDOW_AFTER
      const from = trimmed ? Math.max(0, start - SEARCH_WINDOW_BEFORE) : 0
      const to = trimmed ? Math.min(text.length, start + length + SEARCH_WINDOW_AFTER) : text.length
      results.push({
        line: lineIndex + 1,
        text: `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`,
        startColumn: start - from + 1,
        endColumn: start - from + length + 1,
        lineTruncated: trimmed,
      })
    }
  }
  return results
}

async function searchFile(root, relativePath, query, caseSensitive, config) {
  const target = resolve(root, ...relativePath.split('/'))
  let targetStat
  try {
    targetStat = await stat(target)
  } catch {
    return null
  }
  if (!targetStat.isFile() || targetStat.size === 0) return null
  const truncated = targetStat.size > config.maxSearchFileBytes
  const requested = Math.min(targetStat.size, config.maxSearchFileBytes + 4)
  const buffer = await readPrefix(target, requested)
  const searchBytes = buffer.subarray(0, Math.min(buffer.byteLength, config.maxSearchFileBytes))
  if (containsNul(searchBytes)) return null
  const content = decodeUtf8(searchBytes, truncated)
  if (content === undefined) return null
  const matches = findMatches(content, query, caseSensitive, config.maxMatchesPerFile)
  if (matches.length === 0) return null
  return {
    path: relativePath,
    name: relativePath.slice(relativePath.lastIndexOf('/') + 1),
    matches,
    truncated,
  }
}

/**
 * Walk the workspace (skipping symlinks and configured directories), search the
 * same per-file preview window the browser can display, and return matches
 * grouped by file with 1-based line numbers and match columns.
 */
async function searchWorkspace(workspace, query, caseSensitive, config) {
  const root = await realpath(workspace.path)
  const files = []
  const excluded = new Set(config.searchExcludeDirs.map(name => name.toLowerCase()))
  const walk = async (directory, relativePath) => {
    let raw
    try {
      raw = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const dirent of raw) {
      if (dirent.isSymbolicLink()) continue
      if (dirent.isDirectory()) {
        if (excluded.has(dirent.name.toLowerCase())) continue
        await walk(resolve(directory, dirent.name), entryPath(relativePath, dirent.name))
      } else if (dirent.isFile()) {
        files.push(entryPath(relativePath, dirent.name))
      }
    }
  }
  await walk(root, '')
  files.sort()
  const results = []
  const fileCap = Math.min(files.length, config.maxSearchFiles)
  let index = 0
  let matchCount = 0
  let truncated = false
  const worker = async () => {
    while (index < fileCap && matchCount < config.maxSearchMatches) {
      const relativePath = files[index]
      index += 1
      const found = await searchFile(root, relativePath, query, caseSensitive, config)
      if (found === null) continue
      if (results.length >= config.maxSearchFiles) {
        truncated = true
        break
      }
      results.push(found)
      matchCount += found.matches.length
    }
  }
  const workers = []
  for (let i = 0; i < Math.min(config.searchConcurrency, fileCap); i += 1) workers.push(worker())
  await Promise.all(workers)
  if (index < files.length || matchCount >= config.maxSearchMatches) truncated = true
  results.sort((left, right) => left.path.localeCompare(right.path, 'en', { numeric: true, sensitivity: 'base' }))
  return {
    workspaceId: String(workspace.id),
    query,
    caseSensitive,
    files: results,
    matchCount,
    fileCount: results.length,
    truncated,
  }
}

function containsNul(bytes) {
  for (const byte of bytes) if (byte === 0) return true
  return false
}

function decodeUtf8(bytes, mayEndMidCharacter) {
  const maxTrim = mayEndMidCharacter ? Math.min(3, bytes.byteLength) : 0
  for (let trim = 0; trim <= maxTrim; trim += 1) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytes.byteLength - trim))
    } catch {
      // A truncated valid code point can occupy up to four bytes; try the next shorter prefix.
    }
  }
  return undefined
}

function revisionFor(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Supported text encodings. `id` is the canonical identifier the API and the
 * Web client exchange; `decodeLabel` feeds the WHATWG TextDecoder used for
 * decoding, and `encode` the iconv-lite name used when writing. UTF-8 BOM and
 * UTF-16 LE/BE BOM are written by the encoder itself rather than by callers.
 */
const ENCODINGS = Object.freeze([
  { id: 'utf-8', label: 'UTF-8', decodeLabel: 'utf-8', encode: 'utf8' },
  { id: 'utf-8-bom', label: 'UTF-8（带 BOM）', decodeLabel: 'utf-8', encode: 'utf8' },
  { id: 'utf-16le', label: 'UTF-16 LE', decodeLabel: 'utf-16le', encode: 'utf16-le' },
  { id: 'utf-16be', label: 'UTF-16 BE', decodeLabel: 'utf-16be', encode: 'utf16-be' },
  { id: 'gbk', label: 'GBK', decodeLabel: 'gbk', encode: 'gbk' },
  { id: 'gb18030', label: 'GB18030', decodeLabel: 'gb18030', encode: 'gb18030' },
  { id: 'big5', label: 'Big5', decodeLabel: 'big5', encode: 'big5' },
  { id: 'shift_jis', label: 'Shift_JIS', decodeLabel: 'shift_jis', encode: 'shift_jis' },
  { id: 'euc-jp', label: 'EUC-JP', decodeLabel: 'euc-jp', encode: 'euc-jp' },
  { id: 'euc-kr', label: 'EUC-KR', decodeLabel: 'euc-kr', encode: 'euc-kr' },
  { id: 'iso-8859-1', label: 'ISO-8859-1（Latin-1）', decodeLabel: 'iso-8859-1', encode: 'latin1' },
  { id: 'windows-1252', label: 'Windows-1252', decodeLabel: 'windows-1252', encode: 'windows-1252' },
  { id: 'windows-1251', label: 'Windows-1251（西里尔）', decodeLabel: 'windows-1251', encode: 'windows-1251' },
  { id: 'ascii', label: 'ASCII', decodeLabel: 'ascii', encode: 'ascii' },
])

function encodingById(id) {
  const found = ENCODINGS.find(encoding => encoding.id === id)
  if (found === undefined) throw new HttpError(400, 'unsupported-encoding', '不支持的编码格式')
  return found
}

function hasBom(bytes, encodingId) {
  if (encodingId === 'utf-16le') return bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe
  if (encodingId === 'utf-16be') return bytes.byteLength >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff
  return bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
}

/**
 * Decode bytes strictly as `encodingId`. UTF-8 keeps its existing trim-aware
 * decoder; other encodings use a fatal TextDecoder, retrying progressively
 * shorter prefixes so a truncated trailing character does not fail the read.
 */
function decodeBytes(bytes, encodingId, mayEndMidCharacter) {
  if (encodingId === 'utf-8' || encodingId === 'utf-8-bom') {
    return decodeUtf8(bytes, mayEndMidCharacter)
  }
  const spec = encodingById(encodingId)
  const maxTrim = mayEndMidCharacter ? Math.min(4, bytes.byteLength) : 0
  for (let trim = 0; trim <= maxTrim; trim += 1) {
    try {
      return new TextDecoder(spec.decodeLabel, { fatal: true }).decode(bytes.subarray(0, bytes.byteLength - trim))
    } catch {
      // A truncated multi-byte sequence can occupy up to four bytes; try the next shorter prefix.
    }
  }
  return undefined
}

/**
 * Encode text into bytes for `encodingId`. ASCII replaces non-ASCII characters
 * with '?' (lenient), matching iconv-lite's replacement behaviour for
 * unmappable characters in the other legacy encodings.
 */
function encodeText(text, encodingId) {
  if (encodingId === 'utf-8') return Buffer.from(text, 'utf8')
  if (encodingId === 'utf-8-bom') {
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')])
  }
  if (encodingId === 'ascii') {
    return Buffer.from(text.replace(/[^\x00-\x7f]/g, '?'), 'latin1')
  }
  const spec = encodingById(encodingId)
  let body = iconv.encode(text, spec.encode)
  if (encodingId === 'utf-16le') body = Buffer.concat([Buffer.from([0xff, 0xfe]), body])
  else if (encodingId === 'utf-16be') body = Buffer.concat([Buffer.from([0xfe, 0xff]), body])
  return body
}

/** The encoding id to save back with, preserving a UTF-8 BOM when present. */
function effectiveReadEncoding(requestedId, bom) {
  if (requestedId === 'utf-8' && bom) return 'utf-8-bom'
  return requestedId
}

function textMetadata(bytes, content, encodingId = 'utf-8') {
  const bom = hasBom(bytes, encodingId)
  const crlf = (content.match(/\r\n/g) ?? []).length
  const withoutCrlf = content.replace(/\r\n/g, '')
  const lf = (withoutCrlf.match(/\n/g) ?? []).length
  const cr = (withoutCrlf.match(/\r/g) ?? []).length
  let lineEnding = 'none'
  const kinds = Number(crlf > 0) + Number(lf > 0) + Number(cr > 0)
  if (kinds > 1) lineEnding = 'mixed'
  else if (crlf > 0) lineEnding = 'crlf'
  else if (lf > 0) lineEnding = 'lf'
  else if (cr > 0) lineEnding = 'cr'
  return { bom, lineEnding }
}

async function hasSymlinkComponent(root, relativePath) {
  let current = root
  for (const part of relativePath.split('/')) {
    current = resolve(current, part)
    if ((await lstat(current)).isSymbolicLink()) return true
  }
  return false
}

async function readPrefix(target, length) {
  const buffer = Buffer.alloc(length)
  const handle = await open(target, 'r')
  let offset = 0
  try {
    while (offset < length) {
      const { bytesRead } = await handle.read(buffer, offset, length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
  } finally {
    await handle.close()
  }
  return buffer.subarray(0, offset)
}

async function readPreview(workspace, relativePath, config, encodingId = 'utf-8') {
  if (relativePath === '') throw new HttpError(400, 'not-a-file', '请选择要预览的文件')
  const spec = encodingById(encodingId)
  const root = await realpath(workspace.path)
  const target = await resolveWorkspacePath(root, relativePath)
  const targetStat = await stat(target)
  if (!targetStat.isFile()) throw new HttpError(400, 'not-a-file', '所选路径不是普通文件')
  const requested = Math.min(targetStat.size, config.maxPreviewBytes + 4)
  const buffer = await readPrefix(target, requested)
  const truncated = targetStat.size > config.maxPreviewBytes
  const previewBytes = buffer.subarray(0, Math.min(buffer.byteLength, config.maxPreviewBytes))
  const isUtf16 = encodingId === 'utf-16le' || encodingId === 'utf-16be'
  if (!isUtf16 && containsNul(previewBytes)) throw new HttpError(415, 'binary-file', '该文件包含二进制内容，无法进行文本预览')
  const content = decodeBytes(previewBytes, encodingId, truncated)
  if (content === undefined) throw new HttpError(415, 'invalid-encoding', `该文件不是有效的 ${spec.label} 编码，无法预览`)
  const metadata = textMetadata(previewBytes, content, encodingId)
  const effectiveEncoding = effectiveReadEncoding(encodingId, metadata.bom)
  let readOnlyReason
  if (!config.enableEditing) readOnlyReason = 'editing-disabled'
  else if (truncated) readOnlyReason = 'preview-truncated'
  else if (targetStat.size > config.maxEditableBytes) readOnlyReason = 'file-too-large'
  else if (metadata.lineEnding === 'mixed') readOnlyReason = 'mixed-line-endings'
  else if (await hasSymlinkComponent(root, relativePath)) readOnlyReason = 'symlink-path'
  const result = {
    workspaceId: String(workspace.id), path: relativePath, content, size: targetStat.size,
    truncated, encoding: effectiveEncoding, editable: readOnlyReason === undefined,
    readOnlyReason: readOnlyReason ?? null, maxContextBytes: config.maxContextBytes, ...metadata,
  }
  if (!truncated) result.revision = revisionFor(previewBytes)
  return result
}

function readBody(
  req,
  maximum,
  tooLargeCode = 'file-too-large',
  tooLargeMessage = `请求正文不能超过 ${maximum} 字节`,
  abortedMessage = '请求在正文接收完成前中断',
) {
  return new Promise((resolveBody, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.byteLength
      if (size > maximum) {
        settled = true
        reject(new HttpError(413, tooLargeCode, tooLargeMessage))
        req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!settled) resolveBody(Buffer.concat(chunks, size))
    })
    req.on('aborted', () => {
      if (settled) return
      settled = true
      reject(new HttpError(400, 'request-aborted', abortedMessage))
    })
    req.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
  })
}

async function serializeWrite(queues, key, operation) {
  const previous = queues.get(key) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  queues.set(key, current)
  try {
    return await current
  } finally {
    if (queues.get(key) === current) queues.delete(key)
  }
}

async function saveFile(workspace, relativePath, config, queues, req, encodingId = 'utf-8') {
  if (!config.enableEditing) throw new HttpError(403, 'editing-disabled', '当前未启用文件编辑')
  if (relativePath === '') throw new HttpError(400, 'not-a-file', '请选择要保存的文件')
  const contentType = header(req.headers, 'content-type')?.toLowerCase().replace(/\s/g, '')
  if (contentType !== 'text/plain' && contentType !== 'text/plain;charset=utf-8') {
    throw new HttpError(415, 'invalid-content-type', '保存请求必须使用 text/plain UTF-8 内容')
  }
  const ifMatch = header(req.headers, 'if-match')
  if (ifMatch === undefined || !/^[a-f0-9]{64}$/.test(ifMatch)) {
    throw new HttpError(428, 'revision-required', '保存请求必须提供有效的 If-Match 修订版本')
  }
  const declaredLength = header(req.headers, 'content-length')
  let declared
  if (declaredLength !== undefined) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new HttpError(400, 'invalid-content-length', 'Content-Length 必须是有效的非负整数')
    }
    declared = Number(declaredLength)
    if (!Number.isSafeInteger(declared) || declared > config.maxEditableBytes) {
      throw new HttpError(413, 'file-too-large', `保存内容不能超过 ${config.maxEditableBytes} 字节`)
    }
  }
  const bytes = await readBody(
    req,
    config.maxEditableBytes,
    'file-too-large',
    `保存内容不能超过 ${config.maxEditableBytes} 字节`,
  )
  if (declared !== undefined && bytes.byteLength !== declared) {
    throw new HttpError(400, 'content-length-mismatch', '请求正文长度与 Content-Length 不一致')
  }
  const text = decodeUtf8(bytes, false)
  if (text === undefined || containsNul(bytes)) {
    throw new HttpError(415, 'invalid-text', '保存内容必须是无二进制数据的有效 UTF-8 文本')
  }
  const outBytes = encodeText(text, encodingId)

  // This in-process route provides application-level containment for trusted local UI actions.
  // Fresh canonical checks narrow path replacement races; kernel isolation of hostile concurrent
  // code remains the Harness sandbox's responsibility.
  const root = await realpath(workspace.path)
  const candidate = resolve(root, ...relativePath.split('/'))
  if (!isInside(root, candidate)) throw new HttpError(403, 'path-outside-workspace', '拒绝写入工作区之外的路径')
  return serializeWrite(queues, candidate, async () => {
    if (await hasSymlinkComponent(root, relativePath)) throw new HttpError(403, 'symlink-write-denied', '拒绝通过符号链接写入文件')
    const target = await realpath(candidate)
    if (!isInside(root, target)) throw new HttpError(403, 'path-outside-workspace', '拒绝写入工作区之外的路径')
    const targetStat = await lstat(candidate)
    if (!targetStat.isFile()) throw new HttpError(400, 'not-a-file', '只能保存已存在的普通文件')
    if (targetStat.size > config.maxEditableBytes) throw new HttpError(413, 'file-too-large', '现有文件超过可编辑大小限制')
    const current = await open(candidate, 'r')
    let currentBytes
    try {
      currentBytes = await current.readFile()
    } finally {
      await current.close()
    }
    const isUtf16 = encodingId === 'utf-16le' || encodingId === 'utf-16be'
    if (containsNul(currentBytes) && !isUtf16) {
      throw new HttpError(415, 'binary-file', '现有文件包含二进制内容，不能保存')
    }
    if (encodingId === 'utf-8' && decodeUtf8(currentBytes, false) === undefined) {
      throw new HttpError(415, 'binary-file', '现有文件不是可编辑的 UTF-8 文本')
    }
    if (revisionFor(currentBytes) !== ifMatch) throw new HttpError(409, 'file-conflict', '文件已被修改，请重新加载后再保存')

    const parent = dirname(candidate)
    const realParent = await realpath(parent)
    if (!isInside(root, realParent) || await hasSymlinkComponent(root, relativePath)) {
      throw new HttpError(403, 'symlink-write-denied', '拒绝通过符号链接写入文件')
    }
    const temp = resolve(parent, `.${randomBytes(16).toString('hex')}.dsh-write.tmp`)
    let tempHandle
    let tempCreated = false
    try {
      tempHandle = await open(temp, 'wx', targetStat.mode & 0o777)
      tempCreated = true
      await tempHandle.chmod(targetStat.mode & 0o777)
      await tempHandle.writeFile(outBytes)
      await tempHandle.sync()
      await tempHandle.close()
      tempHandle = undefined
      if (await hasSymlinkComponent(root, relativePath)) throw new HttpError(403, 'symlink-write-denied', '拒绝通过符号链接写入文件')
      const latest = await open(candidate, 'r')
      let latestBytes
      try {
        latestBytes = await latest.readFile()
      } finally {
        await latest.close()
      }
      if (revisionFor(latestBytes) !== ifMatch) throw new HttpError(409, 'file-conflict', '文件已被修改，请重新加载后再保存')
      await rename(temp, candidate)
    } finally {
      if (tempHandle !== undefined) await tempHandle.close().catch(() => {})
      if (tempCreated) {
        await unlink(temp).catch((error) => {
          if (error?.code !== 'ENOENT') throw error
        })
      }
    }
    return { workspaceId: String(workspace.id), path: relativePath, revision: revisionFor(outBytes), size: outBytes.byteLength, encoding: encodingId, bom: hasBom(outBytes, encodingId) }
  })
}

async function readJsonObject(req, config) {
  const contentType = header(req.headers, 'content-type')?.toLowerCase().replace(/\s/g, '')
  if (contentType !== 'application/json' && contentType !== 'application/json;charset=utf-8') {
    throw new HttpError(415, 'invalid-content-type', '请求必须使用 application/json 内容')
  }
  const declaredLength = header(req.headers, 'content-length')
  let declared
  if (declaredLength !== undefined) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new HttpError(400, 'invalid-content-length', 'Content-Length 必须是有效的非负整数')
    }
    declared = Number(declaredLength)
    if (!Number.isSafeInteger(declared) || declared > config.maxMutationBodyBytes) {
      throw new HttpError(413, 'request-too-large', `请求正文不能超过 ${config.maxMutationBodyBytes} 字节`)
    }
  }
  const bytes = await readBody(
    req,
    config.maxMutationBodyBytes,
    'request-too-large',
    `请求正文不能超过 ${config.maxMutationBodyBytes} 字节`,
  )
  if (declared !== undefined && bytes.byteLength !== declared) {
    throw new HttpError(400, 'content-length-mismatch', '请求正文长度与 Content-Length 不一致')
  }
  const text = decodeUtf8(bytes, false)
  if (text === undefined) throw new HttpError(415, 'invalid-json', '请求正文必须是有效 UTF-8 JSON')
  try {
    const value = JSON.parse(text)
    if (!isPlainObject(value)) throw new HttpError(400, 'invalid-json', '请求正文必须是 JSON 对象')
    return value
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, 'invalid-json', '请求正文必须是有效 JSON')
  }
}

async function createEntry(workspace, relativePath, config, queues, req) {
  if (!config.enableEditing) throw new HttpError(403, 'editing-disabled', '当前未启用文件编辑')
  const payload = await readJsonObject(req, config)
  const kind = payload.kind
  if (kind !== 'file' && kind !== 'directory') throw new HttpError(400, 'invalid-kind', '只能新建文件或文件夹')
  const name = normalizeEntryName(payload.name, config.maxEntryNameBytes)
  const root = await realpath(workspace.path)
  const directory = await resolveWorkspacePath(root, relativePath)
  if (await hasSymlinkComponent(root, relativePath)) throw new HttpError(403, 'symlink-write-denied', '拒绝通过符号链接修改目录')
  const directoryStat = await lstat(directory)
  if (!directoryStat.isDirectory()) throw new HttpError(400, 'not-a-directory', '所选路径不是目录')
  const targetPath = entryPath(relativePath, name)
  const target = resolve(directory, name)
  if (!isInside(root, target)) throw new HttpError(403, 'path-outside-workspace', '拒绝写入工作区之外的路径')
  return serializeWrite(queues, target, async () => {
    if (await hasSymlinkComponent(root, relativePath)) throw new HttpError(403, 'symlink-write-denied', '拒绝通过符号链接修改目录')
    try {
      if (kind === 'directory') {
        await mkdir(target)
      } else {
        let handle
        try {
          handle = await open(target, 'wx')
        } finally {
          if (handle !== undefined) await handle.close()
        }
      }
    } catch (error) {
      if (error?.code === 'EEXIST') throw new HttpError(409, 'entry-exists', '同名文件或文件夹已存在')
      throw error
    }
    return describeCreatedEntry(workspace, targetPath, kind)
  })
}

async function renameEntry(workspace, relativePath, config, queues, req) {
  if (!config.enableEditing) throw new HttpError(403, 'editing-disabled', '当前未启用文件编辑')
  if (relativePath === '') throw new HttpError(400, 'invalid-path', '不能重命名工作区根目录')
  const payload = await readJsonObject(req, config)
  const name = normalizeEntryName(payload.name, config.maxEntryNameBytes)
  const currentName = relativePath.slice(relativePath.lastIndexOf('/') + 1)
  const sourceParentPath = parentPath(relativePath)
  const targetPath = entryPath(sourceParentPath, name)
  const root = await realpath(workspace.path)
  const source = await resolveWorkspacePath(root, relativePath)
  if (await hasSymlinkComponent(root, relativePath)) throw new HttpError(403, 'symlink-write-denied', '拒绝重命名符号链接路径')
  const sourceStat = await lstat(source)
  const kind = sourceStat.isDirectory() ? 'directory' : sourceStat.isFile() ? 'file' : undefined
  if (kind === undefined) throw new HttpError(400, 'invalid-entry-kind', '只能重命名文件或文件夹')
  if (name === currentName) return describeCreatedEntry(workspace, relativePath, kind)
  const parent = dirname(source)
  const realParent = await realpath(parent)
  if (!isInside(root, realParent) || await hasSymlinkComponent(root, sourceParentPath)) {
    throw new HttpError(403, 'symlink-write-denied', '拒绝通过符号链接修改目录')
  }
  const target = resolve(parent, name)
  if (!isInside(root, target)) throw new HttpError(403, 'path-outside-workspace', '拒绝写入工作区之外的路径')
  return serializeWrite(queues, target, async () => {
    if (await hasSymlinkComponent(root, relativePath) || await hasSymlinkComponent(root, sourceParentPath)) {
      throw new HttpError(403, 'symlink-write-denied', '拒绝重命名符号链接路径')
    }
    try {
      await lstat(target)
      throw new HttpError(409, 'entry-exists', '同名文件或文件夹已存在')
    } catch (error) {
      if (error instanceof HttpError) throw error
      if (error?.code !== 'ENOENT') throw error
    }
    await rename(source, target)
    return {
      workspaceId: String(workspace.id),
      fromPath: relativePath,
      path: targetPath,
      name,
      kind,
      symlink: false,
    }
  })
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requiredText(value, name, maximum) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
    || /\u0000|[\u0001-\u001f\u007f\u2028\u2029]/u.test(value)) {
    throw new HttpError(400, 'invalid-context', `${name} 无效`)
  }
  return value
}

function requiredInteger(value, name, minimum) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new HttpError(400, 'invalid-context', `${name} 无效`)
  }
  return value
}

function normalizeNewlines(value) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function promptContextPosition(content, offset) {
  let line = 1
  let lineStart = 0
  for (let index = 0; index < offset; index += 1) {
    if (content.charCodeAt(index) !== 10) continue
    line += 1
    lineStart = index + 1
  }
  return { line, column: offset - lineStart + 1 }
}

function validateDirtySelection(selection) {
  const logical = normalizeNewlines(selection.text)
  if (selection.to - selection.from !== logical.length) {
    throw new HttpError(409, 'context-coordinate-mismatch', '选区偏移与选中文本长度不一致')
  }
  const lines = logical.split('\n')
  const endLine = selection.startLine + lines.length - 1
  const endColumn = lines.length === 1
    ? selection.startColumn + lines[0].length
    : lines[lines.length - 1].length + 1
  if (selection.endLine !== endLine || selection.endColumn !== endColumn) {
    throw new HttpError(409, 'context-coordinate-mismatch', '选区行列与选中文本结构不一致')
  }
}

function validatePromptContextPayload(value, config) {
  if (!isPlainObject(value)) throw new HttpError(400, 'invalid-context', '编辑器上下文请求必须是 JSON 对象')
  const sessionId = requiredText(value.sessionId, 'sessionId', 256)
  const workspaceId = requiredText(value.workspaceId, 'workspaceId', 256)
  const path = normalizeRelativePath(requiredText(value.path, 'path', 4096))
  if (path === '') throw new HttpError(400, 'invalid-context', '编辑器上下文必须指定文件路径')
  if (value.mode === 'path') {
    return { sessionId, workspaceId, path, mode: 'path' }
  }
  if (value.mode !== 'selection' || !isPlainObject(value.selection)) {
    throw new HttpError(400, 'invalid-context', '编辑器上下文模式无效')
  }
  if (typeof value.dirty !== 'boolean') throw new HttpError(400, 'invalid-context', 'dirty 无效')
  const revision = value.revision === undefined
    ? undefined
    : typeof value.revision === 'string' && /^[a-f0-9]{64}$/.test(value.revision)
      ? value.revision
      : (() => { throw new HttpError(400, 'invalid-context', 'revision 无效') })()
  if (!value.dirty && revision === undefined) {
    throw new HttpError(409, 'context-revision-required', '未修改的选区必须携带文件修订版本')
  }
  const selection = {
    from: requiredInteger(value.selection.from, 'selection.from', 0),
    to: requiredInteger(value.selection.to, 'selection.to', 1),
    startLine: requiredInteger(value.selection.startLine, 'selection.startLine', 1),
    startColumn: requiredInteger(value.selection.startColumn, 'selection.startColumn', 1),
    endLine: requiredInteger(value.selection.endLine, 'selection.endLine', 1),
    endColumn: requiredInteger(value.selection.endColumn, 'selection.endColumn', 1),
    text: typeof value.selection.text === 'string' ? value.selection.text : '',
  }
  if (selection.text !== value.selection.text || selection.text.includes('\0') || selection.to <= selection.from) {
    throw new HttpError(400, 'invalid-context', '选区内容无效')
  }
  const selectedBytes = Buffer.byteLength(selection.text, 'utf8')
  if (selectedBytes > config.maxContextBytes) {
    throw new HttpError(413, 'context-too-large', `选中文本不能超过 ${config.maxContextBytes} 个 UTF-8 字节`)
  }
  validateDirtySelection(selection)
  return {
    sessionId,
    workspaceId,
    path,
    mode: 'selection',
    dirty: value.dirty,
    ...(revision === undefined ? {} : { revision }),
    selection,
  }
}

async function readPromptContextRequest(req, config) {
  const contentType = header(req.headers, 'content-type')?.toLowerCase().replace(/\s/g, '')
  if (contentType !== 'application/json' && contentType !== 'application/json;charset=utf-8') {
    throw new HttpError(415, 'invalid-content-type', '编辑器上下文请求必须使用 application/json')
  }
  const maximum = Math.min(10 * 1024 * 1024, config.maxContextBytes * 6 + 16 * 1024)
  const bytes = await readBody(
    req,
    maximum,
    'context-request-too-large',
    `编辑器上下文请求不能超过 ${maximum} 字节`,
  )
  const source = decodeUtf8(bytes, false)
  if (source === undefined) throw new HttpError(400, 'invalid-context', '编辑器上下文请求不是有效的 UTF-8 JSON')
  let value
  try {
    value = JSON.parse(source)
  } catch {
    throw new HttpError(400, 'invalid-context', '编辑器上下文请求不是有效的 JSON')
  }
  return validatePromptContextPayload(value, config)
}

async function verifyPromptContextFile(workspace, relativePath) {
  const root = await realpath(workspace.path)
  const target = await resolveWorkspacePath(root, relativePath)
  if (await hasSymlinkComponent(root, relativePath)) {
    throw new HttpError(403, 'context-symlink-denied', '符号链接文件不能加入对话上下文')
  }
  const targetStat = await stat(target)
  if (!targetStat.isFile()) throw new HttpError(400, 'not-a-file', '编辑器上下文目标不是普通文件')
  return { root, path: relativePath, target }
}

async function readCleanPromptContext(file, maximum) {
  const handle = await open(file.target, 'r')
  try {
    const opened = await handle.stat()
    if (!opened.isFile()) throw new HttpError(400, 'not-a-file', '编辑器上下文目标不是普通文件')
    if (opened.size > maximum) {
      throw new HttpError(413, 'context-source-too-large', `上下文源文件不能超过 ${maximum} 字节`)
    }
    if (await hasSymlinkComponent(file.root, file.path)) {
      throw new HttpError(403, 'context-symlink-denied', '符号链接文件不能加入对话上下文')
    }
    const currentTarget = await realpath(file.target)
    if (!isInside(file.root, currentTarget)) {
      throw new HttpError(403, 'path-outside-workspace', '拒绝读取工作区之外的上下文文件')
    }
    const current = await stat(currentTarget)
    if (!current.isFile() || current.dev !== opened.dev || current.ino !== opened.ino) {
      throw new HttpError(409, 'context-file-changed', '上下文文件在发送期间发生变化')
    }
    const buffer = Buffer.alloc(opened.size)
    let offset = 0
    while (offset < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    const settled = await handle.stat()
    if (offset !== opened.size || settled.size !== opened.size) {
      throw new HttpError(409, 'context-file-changed', '上下文文件在发送期间发生变化')
    }
    return buffer
  } finally {
    await handle.close()
  }
}

async function verifyCleanSelection(file, context, maximum) {
  const bytes = await readCleanPromptContext(file, maximum)
  if (revisionFor(bytes) !== context.revision) {
    throw new HttpError(409, 'context-revision-conflict', '文件已变化，请重新选择上下文后再发送')
  }
  if (containsNul(bytes)) throw new HttpError(415, 'binary-file', '上下文文件不是 UTF-8 文本')
  const content = decodeUtf8(bytes, false)
  if (content === undefined) throw new HttpError(415, 'binary-file', '上下文文件不是 UTF-8 文本')
  const metadata = textMetadata(bytes, content)
  const logical = normalizeNewlines(content)
  const { selection } = context
  if (selection.to > logical.length) {
    throw new HttpError(409, 'context-coordinate-mismatch', '选区超出当前文件范围')
  }
  const logicalSlice = logical.slice(selection.from, selection.to)
  const expected = metadata.lineEnding === 'crlf'
    ? logicalSlice.replace(/\n/g, '\r\n')
    : metadata.lineEnding === 'cr'
      ? logicalSlice.replace(/\n/g, '\r')
      : logicalSlice
  if (expected !== selection.text) {
    throw new HttpError(409, 'context-content-mismatch', '选中文本与当前文件内容不一致')
  }
  const start = promptContextPosition(logical, selection.from)
  const end = promptContextPosition(logical, selection.to)
  if (start.line !== selection.startLine || start.column !== selection.startColumn
    || end.line !== selection.endLine || end.column !== selection.endColumn) {
    throw new HttpError(409, 'context-coordinate-mismatch', '选区行列与当前文件不一致')
  }
}

async function workspaceOwnsSession(ctx, workspace, sessionId) {
  if (workspace.sessionIds.some(candidate => String(candidate) === sessionId)) return true
  const session = ctx.sessions.get(sessionId)
  const cwd = session?.header?.cwd
  if (typeof cwd !== 'string' || cwd === '') return false
  try {
    return await realpath(cwd) === await realpath(workspace.path)
  } catch {
    return false
  }
}

async function renderPromptContext(ctx, config, req) {
  const context = await readPromptContextRequest(req, config)
  const workspace = workspaceFor(ctx, context.workspaceId)
  if (!await workspaceOwnsSession(ctx, workspace, context.sessionId)) {
    throw new HttpError(403, 'context-session-denied', '当前会话不属于所选工作区')
  }
  const file = await verifyPromptContextFile(workspace, context.path)
  if (context.mode === 'selection' && !context.dirty) {
    await verifyCleanSelection(file, context, config.maxContextSourceBytes)
  }
  const text = context.mode === 'path'
    ? [
        `<opened_file>The user opened the file ${context.path} in the IDE. This may or may not be related to the current task.</opened_file>`,
      ].join('\n')
    : [
        `<selection>The user selected the lines ${context.selection.startLine} to ${context.selection.endLine} from ${context.path}:`,
        context.selection.text,
        'This may or may not be related to the current task.</selection>',
      ].join('\n')
  const renderedBytes = Buffer.byteLength(text, 'utf8')
  if (renderedBytes > config.maxPromptContextBytes) {
    throw new HttpError(413, 'context-too-large', `完整编辑器上下文不能超过 ${config.maxPromptContextBytes} 个 UTF-8 字节`)
  }
  return { text, bytes: renderedBytes }
}

function workspaceFor(ctx, workspaceId) {
  const workspace = ctx.workspaceRegistry.get(workspaceId)
  if (workspace === undefined) throw new HttpError(404, 'workspace-not-found', '当前工作区不存在')
  return workspace
}

function normalizeFailure(error) {
  if (error instanceof HttpError) return error
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return new HttpError(403, 'path-denied', '没有权限访问该路径')
  if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return new HttpError(404, 'path-not-found', '文件或目录不存在')
  return new HttpError(500, 'workspace-operation-failed', '工作区操作失败')
}

async function handleRequest(ctx, config, trustedHosts, writeQueues, req, res) {
  if (!isTrustedRequest(req, trustedHosts)) {
    sendError(req, res, 403, 'request-not-trusted', '请求来源未获授权')
    return
  }
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const contextEndpoint = url.pathname === `${API_PREFIX}/context`
    const encodingsEndpoint = url.pathname === `${API_PREFIX}/encodings`
    const entryEndpoint = url.pathname === `${API_PREFIX}/entry`
    const fileEndpoint = url.pathname === `${API_PREFIX}/file`
    const treeEndpoint = url.pathname === `${API_PREFIX}/tree`
    const searchEndpoint = url.pathname === `${API_PREFIX}/search`
    const allowed = contextEndpoint
      ? 'POST'
      : encodingsEndpoint
        ? 'GET, HEAD'
        : entryEndpoint
          ? 'POST, PATCH'
          : fileEndpoint
            ? 'GET, HEAD, PUT'
            : treeEndpoint
              ? 'GET, HEAD'
              : searchEndpoint
                ? 'GET, HEAD'
                : undefined
    if (allowed !== undefined && !allowed.split(', ').includes(req.method ?? '')) {
      sendError(req, res, 405, 'method-not-allowed', `该接口只允许 ${allowed} 请求`, { allow: allowed })
      return
    }
    if (!contextEndpoint && !encodingsEndpoint && !entryEndpoint && !fileEndpoint && !treeEndpoint && !searchEndpoint) {
      sendError(req, res, 404, 'endpoint-not-found', '接口不存在')
      return
    }
    if (contextEndpoint) {
      sendJson(req, res, 200, await renderPromptContext(ctx, config, req))
      return
    }
    if (encodingsEndpoint) {
      sendJson(req, res, 200, { encodings: ENCODINGS.map(({ id, label }) => ({ id, label })) })
      return
    }
    const workspaceId = requiredQuery(url, 'workspaceId')
    const workspace = workspaceFor(ctx, workspaceId)
    if (searchEndpoint) {
      const query = requiredQuery(url, 'q')
      if (query.includes('\n') || query.includes('\r')
        || /\u0000|[\u0001-\u001f\u007f\u2028\u2029]/u.test(query)) {
        throw new HttpError(400, 'invalid-query', '搜索内容不能包含换行或控制字符')
      }
      if (query.length > config.maxSearchQueryLength) {
        throw new HttpError(413, 'query-too-long', `搜索内容不能超过 ${config.maxSearchQueryLength} 个字符`)
      }
      const rawCase = url.searchParams.get('caseSensitive')
      sendJson(req, res, 200, await searchWorkspace(workspace, query, rawCase === 'true' || rawCase === '1', config))
      return
    }
    const relativePath = normalizeRelativePath(url.searchParams.get('path') ?? '')
    const encodingId = url.searchParams.get('encoding') ?? 'utf-8'
    if (entryEndpoint && req.method === 'POST') {
      sendJson(req, res, 200, await createEntry(workspace, relativePath, config, writeQueues, req))
    } else if (entryEndpoint) {
      sendJson(req, res, 200, await renameEntry(workspace, relativePath, config, writeQueues, req))
    } else if (treeEndpoint) {
      sendJson(req, res, 200, await listTree(workspace, relativePath, config.maxEntriesPerDirectory))
    } else if (req.method === 'PUT') {
      sendJson(req, res, 200, await saveFile(workspace, relativePath, config, writeQueues, req, encodingId))
    } else {
      sendJson(req, res, 200, await readPreview(workspace, relativePath, config, encodingId))
    }
  } catch (error) {
    const failure = normalizeFailure(error)
    if (failure.status === 500) ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
    sendError(req, res, failure.status, failure.code, failure.message)
  }
}

/** Register the workspace-confined browser API. */
export function apply(ctx, config) {
  const trustedHosts = [...ctx.webRuntime.trustedHosts]
  const writeQueues = new Map()
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: (req, res) => handleRequest(ctx, config, trustedHosts, writeQueues, req, res),
    }),
    'workspace-explorer-layout: workspace API',
  )
}
