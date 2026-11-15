import { encode, tag, withCrcTag, checksum, type TLVTag } from 'promptparse'
import * as val from 'promptparse/validate'

export const num = (s: string) => (s.trim() === '' ? undefined : Number(s))

export type Kind = 'anyId' | 'billPayment' | 'trueMoney' | 'slipVerify' | 'trueMoneySlipVerify' | 'bcelOneProof' | 'emvco'

const DETECTORS: { kind: Kind; label: string; fn: (p: string) => unknown }[] = [
  { kind: 'slipVerify', label: 'Slip Verify (Mini QR)', fn: (p) => val.slipVerify(p) },
  { kind: 'trueMoneySlipVerify', label: 'TrueMoney Slip Verify', fn: (p) => val.trueMoneySlipVerify(p) },
  { kind: 'billPayment', label: 'PromptPay Bill Payment', fn: (p) => val.billPayment(p) },
  { kind: 'anyId', label: 'PromptPay AnyID', fn: (p) => val.anyId(p) },
  { kind: 'bcelOneProof', label: 'BCEL OneProof', fn: (p) => val.bcelOneProof(p) },
]

export function detect(payload: string, tags: TLVTag[]) {
  // The validators in the library are intentionally lenient (some use OR logic),
  // so narrow down by the structure we can actually see before trusting one.
  const has = (id: string, sub?: string) => {
    const t = tags.find((x) => x.id === id)
    return sub ? !!t?.subTags?.find((s) => s.id === sub) : !!t
  }
  const candidates: Kind[] = []
  if (has('91')) {
    candidates.push(has('51') ? 'slipVerify' : 'trueMoneySlipVerify')
  } else if (has('33')) {
    candidates.push('bcelOneProof')
  } else if (has('30')) {
    candidates.push('billPayment')
  } else if (has('29')) {
    candidates.push('anyId')
  }
  for (const k of candidates) {
    const d = DETECTORS.find((x) => x.kind === k)!
    const data = d.fn(payload)
    if (data) {
      const isTmn = k === 'anyId' && tags.find((t) => t.id === '29')?.subTags?.find((s) => s.id === '03')?.value.startsWith('14000')
      return { kind: (isTmn ? 'trueMoney' : k) as Kind, label: isTmn ? 'TrueMoney Wallet (PromptPay e-wallet)' : d.label, data }
    }
  }
  return null
}

export function crcInfo(payload: string, tags: TLVTag[]) {
  const last = tags[tags.length - 1]
  if (!last || last.length !== 4 || !['63', '91'].includes(last.id)) return null
  const body = payload.slice(0, -4)
  const expected = checksum(body, true)
  const ok = last.value.toUpperCase() === expected
  return { id: last.id, actual: last.value, expected, ok }
}

export function decodeTag81(hex: string) {
  if (!/^[0-9A-F]+$/i.test(hex) || hex.length % 4) return null
  let out = ''
  for (let i = 0; i < hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16))
  return out
}


/**
 * Rewrite amount (Tag 54) and Point of Initiation (Tag 01), then recompute CRC.
 * Keeps an existing Tag 54 in place; otherwise inserts it after Tag 58,
 * which is where promptparse's own generators put it.
 */
export function withAmount(tags: TLVTag[], amount: number | undefined) {
  const out: TLVTag[] = []
  let placed = false
  for (const t of tags) {
    if (t.id === '63') continue
    if (t.id === '01') {
      out.push(tag('01', amount ? '12' : '11'))
    } else if (t.id === '54') {
      if (amount) out.push(tag('54', amount.toFixed(2)))
      placed = true
    } else {
      out.push(t)
    }
  }
  if (amount && !placed) {
    const at = out.findIndex((t) => t.id === '58')
    out.splice(at === -1 ? out.length : at + 1, 0, tag('54', amount.toFixed(2)))
  }
  return withCrcTag(encode(out), '63')
}
