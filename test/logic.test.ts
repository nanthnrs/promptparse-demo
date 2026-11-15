import { expect, test } from 'bun:test'
import { parse, parseBarcode } from 'promptparse'
import * as gen from 'promptparse/generate'
import * as val from 'promptparse/validate'
import { detect, crcInfo, withAmount, decodeTag81 } from '../src/logic'

const tagsOf = (p: string) => parse(p)!.getTags()

test('detects each template', () => {
  const cases: [string, string][] = [
    [gen.anyId({ type: 'MSISDN', target: '0812345678', amount: 150 }), 'anyId'],
    [gen.billPayment({ billerId: '010554412345600', ref1: 'INV1', amount: 300 }), 'billPayment'],
    [gen.trueMoney({ mobileNo: '0812345678', amount: 10, message: 'Hi' }), 'trueMoney'],
    [gen.slipVerify({ sendingBank: '002', transRef: '0002123123121200011' }), 'slipVerify'],
    [gen.trueMoneySlipVerify({ eventType: 'P2P', transactionId: 'TXN1', date: '15112026' }), 'trueMoneySlipVerify'],
  ]
  for (const [p, k] of cases) {
    expect(crcInfo(p, tagsOf(p))?.ok).toBe(true)
    expect(detect(p, tagsOf(p))?.kind).toBe(k as any)
  }
})

test('bad CRC is reported with the right expected value', () => {
  const good = gen.anyId({ type: 'NATID', target: '1234567890123' })
  const bad = good.slice(0, -4) + 'FFFF'
  const c = crcInfo(bad, tagsOf(bad))!
  expect(c.ok).toBe(false)
  expect(bad.slice(0, -4) + c.expected).toBe(good)
})

test('withAmount matches the generator output', () => {
  const base = gen.anyId({ type: 'MSISDN', target: '0812345678' })
  expect(withAmount(tagsOf(base), 99.5)).toBe(gen.anyId({ type: 'MSISDN', target: '0812345678', amount: 99.5 }))
  const priced = gen.billPayment({ billerId: '010554412345600', ref1: 'X', ref2: 'Y', ref3: 'Z', amount: 300 })
  expect(withAmount(tagsOf(priced), undefined)).toBe(gen.billPayment({ billerId: '010554412345600', ref1: 'X', ref2: 'Y', ref3: 'Z' }))
  expect(withAmount(tagsOf(priced), 12)).toBe(gen.billPayment({ billerId: '010554412345600', ref1: 'X', ref2: 'Y', ref3: 'Z', amount: 12 }))
  const tmn = gen.trueMoney({ mobileNo: '0812345678', message: 'สวัสดี' })
  expect(val.anyId(withAmount(tagsOf(tmn), 5))?.amount).toBe(5)
})

test('tag 81 decodes Thai', () => {
  const tmn = gen.trueMoney({ mobileNo: '0812345678', message: 'สวัสดี' })
  expect(decodeTag81(parse(tmn)!.getTagValue('81')!)).toBe('สวัสดี')
})

test('BOT barcode round-trip', () => {
  const b = gen.botBarcode({ billerId: '099999999999990', ref1: '111222333444', amount: 363 })
  const bc = parseBarcode(b)!
  expect(bc.amount).toBe(363)
  expect(val.billPayment(bc.toQrTag30())?.amount).toBe(363)
})
