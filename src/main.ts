import './style.css'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import {
  parse,
  parseBarcode,
  encode,
  tag,
  withCrcTag,
  checksum,
  type TLVTag,
} from 'promptparse'
import * as gen from 'promptparse/generate'
import { num, detect, crcInfo, decodeTag81, withAmount, type Kind } from './logic'

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
  document.querySelector(sel) as T

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const ARROW =
  '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'

const visible = (s: string) => s.replace(/\r/g, '\\r').replace(/\n/g, '\\n')

function toast(msg: string) {
  let el = document.querySelector('.toast') as HTMLDivElement | null
  if (!el) {
    el = document.createElement('div')
    el.className = 'toast'
    document.body.append(el)
  }
  el.textContent = msg
  el.classList.add('show')
  clearTimeout((el as any)._t)
  ;(el as any)._t = setTimeout(() => el!.classList.remove('show'), 1600)
}

/** Copy to clipboard; when a button is given, it confirms in place for a moment. */
async function copy(text: string, btn?: HTMLElement | null) {
  let ok = true
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    ok = false
  }
  toast(ok ? 'คัดลอกแล้ว' : 'คัดลอกไม่สำเร็จ')
  if (!btn) return
  const label = btn.dataset.label ?? btn.textContent ?? ''
  btn.dataset.label = label
  btn.textContent = ok ? 'คัดลอกแล้ว' : 'คัดลอกไม่สำเร็จ'
  btn.classList.toggle('done', ok)
  clearTimeout(Number(btn.dataset.timer))
  btn.dataset.timer = String(
    setTimeout(() => {
      btn.textContent = label
      btn.classList.remove('done')
    }, 1500),
  )
}

/* ------------------------------------------------------------------ */
/* Generate templates                                                  */
/* ------------------------------------------------------------------ */

type Field = {
  key: string
  label: string
  type?: 'text' | 'number' | 'select'
  options?: { value: string; label: string }[]
  placeholder?: string
  value?: string
  optional?: boolean
  /** Shown in both modes */
  help?: string
  /** Extra detail shown only in developer mode */
  devHelp?: string
}

type Template = {
  id: string
  /** Plain-language name shown in the picker */
  title: string
  /** One-line description in the picker */
  desc: string
  hint: string
  kind: 'qr' | 'barcode'
  group: 'payment' | 'testing'
  fields: Field[]
  run: (v: Record<string, string>) => string
  code: (v: Record<string, string>) => string
}

const opt = (s: string) => (s.trim() === '' ? undefined : s.trim())

function objLiteral(o: Record<string, unknown>) {
  const lines = Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `  ${k}: ${typeof v === 'string' ? `'${v}'` : v},`)
  return `{\n${lines.join('\n')}\n}`
}

const templates: Template[] = [
  {
    id: 'anyId',
    title: 'PromptPay รับเงินเข้าบุคคล',
    desc: 'โอนเข้าเบอร์มือถือ, เลขบัตรประชาชน หรือ e-wallet',
    hint: 'QR PromptPay ส่วนบุคคล โอนเข้าเบอร์มือถือ, เลขบัตรประชาชน / เลขผู้เสียภาษี หรือ e-wallet ID',
    kind: 'qr',
    group: 'payment',
    fields: [
      {
        key: 'type',
        label: 'ระบุผู้รับเงินด้วย',
        devHelp: 'ใน code เรียกว่า proxy type ใช้ค่า MSISDN (เบอร์มือถือ), NATID หรือ EWALLETID',
        type: 'select',
        options: [
          { value: 'MSISDN', label: 'เบอร์มือถือ' },
          { value: 'NATID', label: 'เลขบัตรประชาชน / เลขผู้เสียภาษี' },
          { value: 'EWALLETID', label: 'e-wallet ID' },
        ],
        value: 'MSISDN',
      },
      { key: 'target', label: 'เบอร์ / เลขที่ของผู้รับเงิน', placeholder: '0812345678', value: '0812345678', help: 'ต้องผูก PromptPay ไว้แล้ว', devHelp: 'เบอร์มือถือใส่แบบ 08x ได้ library แปลงเป็น 0066 ให้' },
      { key: 'amount', label: 'จำนวนเงิน (บาท)', help: 'เว้นว่างได้ ผู้จ่ายจะกรอกจำนวนเองในแอปธนาคาร', type: 'number', placeholder: 'ไม่ระบุจำนวน', optional: true, value: '150' },
    ],
    run: (v) => gen.anyId({ type: v.type as any, target: v.target.trim(), amount: num(v.amount) }),
    code: (v) =>
      `import { anyId } from 'promptparse/generate'\n\nanyId(${objLiteral({ type: v.type, target: v.target.trim(), amount: num(v.amount) })})`,
  },
  {
    id: 'billPayment',
    title: 'PromptPay ชำระบิล',
    desc: 'ร้านค้าหรือบริษัทรับชำระบิล มี biller ID และเลขอ้างอิง',
    hint: 'QR ชำระบิลของร้านค้า ใช้ biller ID (เลขผู้เสียภาษี + suffix) และเลขอ้างอิง',
    kind: 'qr',
    group: 'payment',
    fields: [
      { key: 'billerId', label: 'Biller ID', placeholder: '010554412345600', value: '010554412345600', help: 'เลขผู้เสียภาษี 13 หลัก + suffix 2 หลัก ได้จากธนาคารตอนสมัครรับชำระบิล' },
      { key: 'ref1', label: 'เลขอ้างอิง 1', placeholder: 'INV12345', value: 'INV12345', help: 'ใช้จับคู่ว่าการชำระนี้เป็นของบิลไหน เช่น เลขใบแจ้งหนี้หรือรหัสลูกค้า' },
      { key: 'ref2', label: 'เลขอ้างอิง 2', optional: true, placeholder: 'ไม่บังคับ' },
      { key: 'ref3', label: 'เลขอ้างอิง 3', optional: true, placeholder: 'ไม่บังคับ (ไม่มีใน spec, Tag 62.07)' },
      { key: 'amount', label: 'จำนวนเงิน (บาท)', help: 'เว้นว่างได้ ผู้จ่ายจะกรอกจำนวนเองในแอปธนาคาร', type: 'number', optional: true, placeholder: 'ไม่ระบุจำนวน', value: '300' },
    ],
    run: (v) =>
      gen.billPayment({
        billerId: v.billerId.trim(),
        ref1: v.ref1.trim(),
        ref2: opt(v.ref2),
        ref3: opt(v.ref3),
        amount: num(v.amount),
      }),
    code: (v) =>
      `import { billPayment } from 'promptparse/generate'\n\nbillPayment(${objLiteral({
        billerId: v.billerId.trim(),
        ref1: v.ref1.trim(),
        ref2: opt(v.ref2),
        ref3: opt(v.ref3),
        amount: num(v.amount),
      })})`,
  },
  {
    id: 'trueMoney',
    title: 'TrueMoney Wallet',
    desc: 'รับเงินเข้า TrueMoney แนบข้อความได้',
    hint: 'QR TrueMoney แอปธนาคารอื่นสแกนได้เหมือน QR PromptPay แบบ e-wallet แต่จะไม่เห็นข้อความ (Tag 81)',
    kind: 'qr',
    group: 'payment',
    fields: [
      { key: 'mobileNo', label: 'เบอร์มือถือ', placeholder: '0812345678', value: '0812345678' },
      { key: 'amount', label: 'จำนวนเงิน (บาท)', help: 'เว้นว่างได้ ผู้จ่ายจะกรอกจำนวนเองในแอปธนาคาร', type: 'number', optional: true, placeholder: 'ไม่ระบุจำนวน', value: '10' },
      { key: 'message', label: 'ข้อความ', optional: true, placeholder: 'ขอบคุณครับ', value: 'ขอบคุณครับ', help: 'แสดงเฉพาะในแอป TrueMoney แอปธนาคารจะไม่เห็น' },
    ],
    run: (v) => gen.trueMoney({ mobileNo: v.mobileNo.trim(), amount: num(v.amount), message: opt(v.message) }),
    code: (v) =>
      `import { trueMoney } from 'promptparse/generate'\n\ntrueMoney(${objLiteral({
        mobileNo: v.mobileNo.trim(),
        amount: num(v.amount),
        message: opt(v.message),
      })})`,
  },
  {
    id: 'botBarcode',
    title: 'Barcode ชำระบิล',
    desc: 'barcode แบบเส้นบนใบแจ้งหนี้ ตามมาตรฐาน ธปท.',
    hint: 'Barcode ชำระบิลตามมาตรฐานธนาคารแห่งประเทศไทย (ข้อมูล Code 128) แปลงเป็น QR Tag 30 ได้ในหน้าตรวจ',
    kind: 'barcode',
    group: 'payment',
    fields: [
      { key: 'billerId', label: 'Biller ID', placeholder: '099999999999990', value: '099999999999990' },
      { key: 'ref1', label: 'เลขอ้างอิง 1', placeholder: '111222333444', value: '111222333444' },
      { key: 'ref2', label: 'เลขอ้างอิง 2', optional: true, placeholder: 'ไม่บังคับ' },
      { key: 'amount', label: 'จำนวนเงิน (บาท)', help: 'เว้นว่างได้ ผู้จ่ายจะกรอกจำนวนเองในแอปธนาคาร', type: 'number', optional: true, placeholder: 'เว้นว่าง = ไม่ระบุ', value: '363' },
    ],
    run: (v) =>
      gen.botBarcode({ billerId: v.billerId.trim(), ref1: v.ref1.trim(), ref2: opt(v.ref2), amount: num(v.amount) }),
    code: (v) =>
      `import { botBarcode } from 'promptparse/generate'\n\nbotBarcode(${objLiteral({
        billerId: v.billerId.trim(),
        ref1: v.ref1.trim(),
        ref2: opt(v.ref2),
        amount: num(v.amount),
      })})`,
  },
  {
    id: 'slipVerify',
    title: 'QR บนสลิปโอนเงิน',
    desc: 'QR เล็กบนสลิปธนาคาร ใช้ทดสอบระบบตรวจสลิป',
    hint: 'QR เล็กๆ บนสลิปโอนเงิน มีแค่รหัสธนาคารกับเลขอ้างอิง ใช้ทดสอบระบบตรวจสลิปที่ต่อกับ Bank Open API เท่านั้น ไม่ใช่ QR ชำระเงิน',
    kind: 'qr',
    group: 'testing',
    fields: [
      { key: 'sendingBank', label: 'รหัสธนาคารผู้โอน', placeholder: '002', value: '002', help: 'รหัสธนาคาร 3 หลัก เช่น 002 ธนาคารกรุงเทพ, 004 กสิกรไทย, 014 ไทยพาณิชย์' },
      { key: 'transRef', label: 'เลขอ้างอิงรายการ', placeholder: '0002123123121200011', value: '0002123123121200011' },
    ],
    run: (v) => gen.slipVerify({ sendingBank: v.sendingBank.trim(), transRef: v.transRef.trim() }),
    code: (v) =>
      `import { slipVerify } from 'promptparse/generate'\n\nslipVerify(${objLiteral({
        sendingBank: v.sendingBank.trim(),
        transRef: v.transRef.trim(),
      })})`,
  },
  {
    id: 'trueMoneySlipVerify',
    title: 'QR บนสลิป TrueMoney',
    desc: 'แบบเดียวกันของ TrueMoney ใช้ทดสอบระบบตรวจสลิป',
    hint: 'QR บนสลิปของ TrueMoney (ใช้ CRC ตัวพิมพ์เล็กและมี tag เฉพาะของ TrueMoney) ใช้ทดสอบระบบตรวจสลิปเท่านั้น ไม่ใช่ QR ชำระเงิน และไม่มีข้อมูลจำนวนเงินหรือบัญชี',
    kind: 'qr',
    group: 'testing',
    fields: [
      { key: 'eventType', label: 'ประเภทรายการ', placeholder: 'P2P', value: 'P2P' },
      { key: 'transactionId', label: 'Transaction ID', placeholder: 'TXN0123456789', value: 'TXN0123456789' },
      { key: 'date', label: 'วันที่ (DDMMYYYY)', placeholder: '15112026', value: '15112026' },
    ],
    run: (v) =>
      gen.trueMoneySlipVerify({
        eventType: v.eventType.trim(),
        transactionId: v.transactionId.trim(),
        date: v.date.trim(),
      }),
    code: (v) =>
      `import { trueMoneySlipVerify } from 'promptparse/generate'\n\ntrueMoneySlipVerify(${objLiteral({
        eventType: v.eventType.trim(),
        transactionId: v.transactionId.trim(),
        date: v.date.trim(),
      })})`,
  },
]

const state = { template: templates[0], payload: '' }

/** Turn a template's call into a copy-pasteable snippet that also shows how to render it. */
function fullSnippet(t: Template, v: Record<string, string>) {
  const [importLine, call] = t.code(v).split('\n\n')
  if (t.kind === 'barcode') {
    return `${importLine}\n\nconst payload = ${call}\n\n// payload คือข้อความใน barcode ส่งให้ library barcode (Code 128) วาดเป็นรูป`
  }
  return `${importLine}\nimport QRCode from 'qrcode'\n\nconst payload = ${call}\n\n// promptparse ให้แค่ payload (string)\n// ใช้ library QR อื่นวาดเป็นรูป เช่น qrcode\nconst image = await QRCode.toDataURL(payload)`
}

function renderTemplateList() {
  const list = $('#template-list')
  const groups: [Template['group'], string][] = [
    ['payment', 'QR และ barcode สำหรับรับเงิน'],
    ['testing', 'สำหรับทดสอบระบบตรวจสลิป (ไม่ใช่ QR รับเงิน)'],
  ]
  list.innerHTML = groups
    .map(
      ([g, label]) =>
        `<div class="tpl-set${g === 'testing' ? ' dev-only' : ''}"><p class="tpl-group">${esc(label)}</p>${templates
          .filter((t) => t.group === g)
          .map(
            (t) => `<label class="tpl">
              <input type="radio" name="tpl" value="${t.id}"${t === state.template ? ' checked' : ''} />
              <span class="tpl-body">
                <span class="tpl-title">${esc(t.title)}</span>
                <span class="tpl-desc">${esc(t.desc)}</span>
              </span>
              <code class="tpl-fn dev-only">${t.id}()</code>
            </label>`,
          )
          .join('')}</div>`,
    )
    .join('')
  list.addEventListener('change', (e) => {
    const id = (e.target as HTMLInputElement).value
    state.template = templates.find((t) => t.id === id)!
    renderForm()
  })
}

function renderForm() {
  const t = state.template
  $('#template-hint').textContent = t.hint
  const form = $<HTMLFormElement>('#gen-form')
  form.innerHTML = t.fields
    .map((f) => {
      const label = `<span>${esc(f.label)}${f.optional ? ' <em>ไม่บังคับ</em>' : ''}</span>`
      const help =
        f.help || f.devHelp
          ? `<small class="help">${f.help ? esc(f.help) : ''}${f.devHelp ? `<span class="dev-only"> ${esc(f.devHelp)}</span>` : ''}</small>`
          : ''
      if (f.type === 'select') {
        return `<label class="field">${label}<select name="${f.key}">${f.options!
          .map((o) => `<option value="${o.value}"${o.value === f.value ? ' selected' : ''}>${esc(o.label)}</option>`)
          .join('')}</select>${help}</label>`
      }
      return `<label class="field">${label}<input name="${f.key}" ${
        f.type === 'number' ? 'type="number" step="0.01" min="0" inputmode="decimal"' : 'type="text"'
      } placeholder="${esc(f.placeholder ?? '')}" value="${esc(f.value ?? '')}" />${help}</label>`
    })
    .join('')
  form.oninput = generate
  form.onsubmit = (e) => e.preventDefault()
  generate()
}

function formValues() {
  const fd = new FormData($<HTMLFormElement>('#gen-form'))
  const v: Record<string, string> = {}
  for (const f of state.template.fields) v[f.key] = String(fd.get(f.key) ?? '')
  return v
}

async function generate() {
  const t = state.template
  const v = formValues()
  const err = $('#gen-error')
  const visual = $('#gen-visual')
  $('#gen-code').textContent = fullSnippet(t, v)
  $('#gen-explain').innerHTML =
    t.kind === 'qr'
      ? `string ที่ <code>${t.id}()</code> return ออกมา นี่คือข้อมูลที่อยู่ใน QR ด้านบน แต่ละช่องสีคือ 1 tag ชี้หรือแตะเพื่อดูว่าเป็น tag อะไร`
      : `string ที่ <code>${t.id}()</code> return ออกมา คือข้อความใน barcode แบบเส้น (Code 128) อักขระขึ้นบรรทัดแสดงเป็น <code>\\r</code>`
  $('#gen-user-note').textContent =
    t.kind === 'qr'
      ? 'ให้ผู้จ่ายสแกน QR นี้ด้วยแอปธนาคาร หรือดาวน์โหลดไปพิมพ์'
      : 'barcode ชำระบิลเป็น barcode แบบเส้น หน้านี้แสดงเป็นข้อความ ใช้ปุ่ม "แปลงเป็น QR" เพื่อดู QR ชำระบิลที่มีข้อมูลเดียวกัน'
  try {
    const missing = t.fields.filter((f) => !f.optional && !v[f.key].trim())
    for (const f of t.fields) {
      const el = document.querySelector<HTMLElement>(`#gen-form [name="${f.key}"]`)
      if (missing.includes(f)) el?.setAttribute('aria-invalid', 'true')
      else el?.removeAttribute('aria-invalid')
    }
    if (missing.length) throw new Error(`กรุณากรอก: ${missing.map((m) => m.label).join(', ')}`)
    const payload = t.run(v)
    state.payload = payload
    err.hidden = true
    $('#gen-payload').innerHTML = t.kind === 'qr' ? anatomy(payload) : esc(visible(payload))
    $('#gen-meta').textContent = `${Array.from(payload).length} ตัวอักษร`
    if (t.kind === 'qr') {
      const canvas = document.createElement('canvas')
      await QRCode.toCanvas(canvas, payload, { width: 560, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0d2236', light: '#ffffff' } })
      visual.replaceChildren(canvas)
      visual.classList.remove('is-barcode')
    } else {
      visual.innerHTML = `<div class="barcode-note"><strong>ข้อมูล Code 128</strong><p>BOT barcode เป็น barcode แบบเส้น อักขระควบคุมแสดงเป็น <code>\\r</code> แปลงเป็น QR PromptPay Tag 30 ได้ในหน้าตรวจ</p></div>`
      visual.classList.add('is-barcode')
    }
    $<HTMLButtonElement>('#gen-download').disabled = t.kind !== 'qr'
  } catch (e) {
    state.payload = ''
    err.textContent = (e as Error).message
    err.hidden = false
    visual.replaceChildren()
    $('#gen-payload').textContent = ''
    $('#gen-meta').textContent = ''
  }
}

/* ------------------------------------------------------------------ */
/* Tag dictionary + anatomy                                            */
/* ------------------------------------------------------------------ */


const EMV_TAGS: Record<string, string> = {
  '00': 'Payload Format Indicator',
  '01': 'Point of Initiation Method',
  '29': 'Merchant Account: PromptPay AnyID',
  '30': 'Merchant Account: PromptPay Bill Payment',
  '31': 'Merchant Account',
  '33': 'Merchant Account (BCEL)',
  '52': 'Merchant Category Code',
  '53': 'Transaction Currency',
  '54': 'Transaction Amount',
  '55': 'Tip or Convenience Indicator',
  '58': 'Country Code',
  '59': 'Merchant Name',
  '60': 'Merchant City',
  '61': 'Postal Code',
  '62': 'Additional Data Field',
  '63': 'CRC',
  '81': 'TrueMoney Personal Message (UCS-2 hex)',
}

const SUB_TAGS: Record<string, Record<string, string>> = {
  '29': { '00': 'Application ID', '01': 'Mobile Number (MSISDN)', '02': 'National ID / Tax ID', '03': 'E-Wallet ID', '04': 'Bank Account' },
  '30': { '00': 'Application ID', '01': 'Biller ID', '02': 'Reference 1', '03': 'Reference 2' },
  '62': { '01': 'Bill Number', '05': 'Reference Label', '07': 'Terminal Label (Ref 3)' },
  '33': { '00': 'Issuer', '02': 'Type', '03': 'Ticket No.', '04': 'Reference No.' },
}

const SLIP_TAGS: Record<string, string> = { '00': 'API Data', '51': 'Country Code', '91': 'CRC' }
const SLIP_SUB: Record<string, string> = { '00': 'API Type', '01': 'Sending Bank', '02': 'Transaction Ref' }
const TMN_SLIP_SUB: Record<string, string> = { '00': 'Version', '01': 'Version', '02': 'Event Type', '03': 'Transaction ID', '04': 'Date (DDMMYYYY)' }

function isSlip(tags: TLVTag[]) {
  return tags.some((t) => t.id === '91')
}

function tagName(id: string, kind: Kind | null, tags: TLVTag[]) {
  if (isSlip(tags)) return SLIP_TAGS[id] ?? ''
  if (id >= '02' && id <= '51' && !EMV_TAGS[id]) return 'Merchant Account Information'
  if (id >= '80' && id <= '99' && !EMV_TAGS[id]) return 'Unreserved Template'
  void kind
  return EMV_TAGS[id] ?? ''
}

function subTagName(parent: string, id: string, kind: Kind | null) {
  if (kind === 'trueMoneySlipVerify' && parent === '00') return TMN_SLIP_SUB[id] ?? ''
  if (kind === 'slipVerify' && parent === '00') return SLIP_SUB[id] ?? ''
  return SUB_TAGS[parent]?.[id] ?? ''
}

/** Colour-coded payload: each top-level tag gets its own hue band. */
function anatomy(payload: string) {
  const p = parse(payload)
  if (!p) return esc(payload)
  return p
    .getTags()
    .map((t, i) => {
      const len = ('00' + t.length).slice(-2)
      const name = tagName(t.id, null, p.getTags())
      const title = `Tag ${t.id}${name ? ` ${name}` : ''} · ยาว ${t.length} ตัวอักษร`
      return `<span class="seg h${i % 6}" data-tag="${t.id}" title="${esc(title)}"><b>${t.id}</b><i>${len}</i>${esc(t.value)}</span>`
    })
    .join('')
}

/* ------------------------------------------------------------------ */
/* Inspect                                                             */
/* ------------------------------------------------------------------ */

function renderTagRows(tags: TLVTag[], kind: Kind | null, all: TLVTag[]) {
  return tags
    .map((t, i) => {
      const name = tagName(t.id, kind, all)
      let extra = ''
      if (t.id === '81') {
        const msg = decodeTag81(t.value)
        if (msg) extra = `<div class="decoded">“${esc(msg)}”</div>`
      }
      if (t.id === '53' && t.value === '764') extra = `<div class="decoded">THB</div>`
      if (t.id === '01') extra = `<div class="decoded">${t.value === '11' ? 'Static (ใช้ซ้ำได้)' : t.value === '12' ? 'Dynamic (ใช้ครั้งเดียว)' : ''}</div>`
      const subs = t.subTags
        ? `<div class="subtags">${t.subTags
            .map(
              (s) =>
                `<div class="row sub"><span class="id mono">${t.id}.${s.id}</span><span class="name">${esc(
                  subTagName(t.id, s.id, kind),
                )}</span><span class="len mono">${s.length}</span><span class="val mono">${esc(s.value)}</span></div>`,
            )
            .join('')}</div>`
        : ''
      return `<div class="tag-block h${i % 6}" data-tag="${t.id}">
          <div class="row"><span class="id mono">${t.id}</span><span class="name">${esc(name)}</span><span class="len mono">${t.length}</span><span class="val mono">${esc(t.value)}${extra}</span></div>
          ${subs}
        </div>`
    })
    .join('')
}

function literal(data: Record<string, unknown>) {
  const lines = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `  ${k}: ${typeof v === 'string' ? `'${v}'` : v === null ? 'null' : v},`)
  return `{\n${lines.join('\n')}\n}`
}

const DATA_LABELS: Record<string, string> = {
  type: 'ระบุผู้รับด้วย',
  target: 'ผู้รับเงิน',
  mobileNo: 'เบอร์ TrueMoney ผู้รับเงิน',
  amount: 'จำนวนเงิน (บาท)',
  billerId: 'Biller ID',
  ref1: 'เลขอ้างอิง 1',
  ref2: 'เลขอ้างอิง 2',
  ref3: 'เลขอ้างอิง 3',
  sendingBank: 'รหัสธนาคารผู้โอน',
  transRef: 'เลขอ้างอิงรายการ',
  eventType: 'ประเภทรายการ',
  transactionId: 'Transaction ID',
  date: 'วันที่',
  ticket: 'Ticket No.',
  fccref: 'Reference No.',
}

const TYPE_LABELS: Record<string, string> = {
  MSISDN: 'เบอร์มือถือ',
  NATID: 'เลขบัตรประชาชน / เลขผู้เสียภาษี',
  EWALLETID: 'e-wallet ID',
  BANKACC: 'บัญชีธนาคาร',
}

/** TrueMoney QRs carry the mobile number as an e-wallet ID (14000 + number); show the number. */
function friendlyData(kind: Kind | null, data: Record<string, unknown>) {
  if (kind === 'trueMoney' && typeof data.target === 'string') {
    return { mobileNo: data.target.replace(/^14000/, ''), amount: data.amount }
  }
  return data
}

/** Plain key/value list for user mode. */
function userData(data: Record<string, unknown>) {
  const rows = Object.entries(data)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => {
      const value = k === 'type' ? (TYPE_LABELS[String(v)] ?? String(v)) : String(v)
      return `<div><dt>${esc(DATA_LABELS[k] ?? k)}</dt><dd>${esc(value)}</dd></div>`
    })
  return `<dl class="kv user-only">${rows.join('')}</dl>`
}

function snippet(head: string, code: string) {
  return `<div class="snippet dev-only"><div class="code-head">${esc(head)}</div><pre><code>${esc(code)}</code></pre></div>`
}

function validator(kind: Kind | null) {
  return kind === 'trueMoney' ? 'anyId' : String(kind)
}

function tagLegend(tags: TLVTag[]) {
  const t = tags.find((x) => x.id === '54') ?? tags[0]
  const len = ('00' + t.length).slice(-2)
  const name = tagName(t.id, null, tags) || 'tag'
  return `<div class="legend">
      <span class="seg h0"><b>${t.id}</b><i>${len}</i>${esc(t.value)}</span>
      <span class="legend-parts">
        <span><b class="mono">${t.id}</b> ID ของ tag (${esc(name)})</span>
        <span><i class="mono">${len}</i> ความยาวของค่า ${t.length} ตัวอักษร</span>
        <span><span class="mono">${esc(t.value)}</span> ค่า</span>
      </span>
    </div>`
}

function inspect(raw: string) {
  const out = $('#ins-result')
  const payload = raw.replace(/\\r/g, '\r').trim()
  if (!payload) {
    out.innerHTML = `<div class="empty">วาง payload ในช่องด้านบน เลือกรูป QR หรือกดตัวอย่าง แล้วผลการอ่านจะแสดงที่นี่</div>`
    return
  }

  // BOT barcode
  if (payload.startsWith('|')) {
    const bc = parseBarcode(payload)
    if (!bc) {
      out.innerHTML = `<div class="card bad"><h3>BOT barcode ไม่ถูกต้อง</h3><p>BOT barcode ต้องมี 4 ช่องคั่นด้วย <code>\\r</code> คือ biller ID, ref 1, ref 2 และจำนวนเงิน</p></div>`
      return
    }
    const qr = bc.toQrTag30()
    out.innerHTML = `
      <div class="card">
        <h3>ผลการอ่าน</h3>
        <div class="verdict ok"><span class="pill">Barcode ชำระบิล</span> ตามมาตรฐาน ธปท.</div>
        ${userData({ billerId: bc.billerId, ref1: bc.ref1, ref2: bc.ref2 ?? undefined, amount: bc.amount ?? undefined })}
        ${snippet(
          'code ที่ใช้อ่าน และผลลัพธ์',
          `import { parseBarcode } from 'promptparse'\n\nconst barcode = parseBarcode(payload)\n// barcode:\n${literal({ billerId: bc.billerId, ref1: bc.ref1, ref2: bc.ref2, amount: bc.amount })}`,
        )}
      </div>
      <div class="card convert">
        <div>
          <h3>แปลงเป็น QR PromptPay ชำระบิล</h3>
          <p class="hint"><span class="dev-only">เรียก <code>barcode.toQrTag30()</code> จะได้ payload ของ QR ชำระบิล (Tag 30) ที่มีข้อมูลเดียวกัน </span>ใช้ได้หรือไม่ขึ้นกับธนาคารของผู้รับชำระ</p>
          <div class="payload mono dev-only">${anatomy(qr)}</div>
          <div class="actions"><button class="btn primary" data-load="${esc(qr)}">ตรวจ QR นี้ ${ARROW}</button></div>
        </div>
        <div class="qr-frame small" id="bc-qr"></div>
      </div>`
    const c = document.createElement('canvas')
    QRCode.toCanvas(c, qr, { width: 400, margin: 1, color: { dark: '#0d2236', light: '#ffffff' } }).then(() => $('#bc-qr')?.append(c))
    return
  }

  const p = parse(payload, false)
  if (!p) {
    out.innerHTML = `<div class="card bad"><h3>อ่านข้อมูลไม่ได้</h3><p>ข้อมูลนี้ไม่ใช่ EMVCo TLV แต่ละ tag ต้องเป็น ID 2 หลัก ตามด้วยความยาว 2 หลัก แล้วจึงเป็นค่า</p></div>`
    return
  }
  const tags = p.getTags()
  const crc = crcInfo(payload, tags)
  const found = crc?.ok ? detect(payload, tags) : null
  const kind = found?.kind ?? null
  const editable = !!crc?.ok && crc.id === '63' && (kind === 'anyId' || kind === 'billPayment' || kind === 'trueMoney')
  const currentAmount = p.getTagValue('54')

  out.innerHTML = `
    <div class="card summary">
      <h3>ผลการอ่าน</h3>
      <div class="verdicts">
        ${
          crc
            ? crc.ok
              ? `<div class="verdict ok"><span class="pill"><span class="user-only">ข้อมูลครบถ้วน</span><span class="dev-only">CRC ถูกต้อง</span></span> <span class="user-only">QR นี้ไม่ได้ถูกแก้ไข</span><span class="dev-only">checksum <code>${crc.actual}</code> ตรงกับข้อมูล payload ไม่ได้ถูกแก้</span></div>`
              : `<div class="verdict bad"><span class="pill"><span class="user-only">ข้อมูลไม่ถูกต้อง</span><span class="dev-only">CRC ไม่ตรง</span></span> <span class="user-only">ข้อความอาจพิมพ์ผิดหรือถูกแก้ แอปธนาคารจะไม่รับ QR นี้</span><span class="dev-only">checksum 4 ตัวท้ายคือ <code>${esc(crc.actual)}</code> แต่ควรเป็น <code>${crc.expected}</code> payload อาจพิมพ์ผิดหรือถูกแก้ แอปธนาคารจะไม่ยอมรับ</span> <button class="link" data-load="${esc(payload.slice(0, -4) + crc.expected)}">แก้ checksum ให้ถูก</button></div>`
            : `<div class="verdict warn"><span class="pill">ไม่ใช่ QR ชำระเงิน</span> <span class="user-only">ไม่พบส่วนตรวจสอบข้อมูลท้ายข้อความ</span><span class="dev-only">ไม่พบ CRC tag (63 หรือ 91) ท้ายข้อมูล</span></div>`
        }
        ${
          found
            ? `<div class="verdict ok"><span class="pill">${esc(found.label)}</span> ประเภทของ QR นี้</div>`
            : crc?.ok
              ? `<div class="verdict warn"><span class="pill">QR ประเภทอื่น</span> <span class="user-only">อ่านได้ แต่ไม่ใช่ QR PromptPay หรือ TrueMoney ที่รู้จัก</span><span class="dev-only">อ่าน tag ได้ แต่ไม่ใช่ประเภทที่ <code>validate</code> รู้จัก ดูข้อมูลดิบได้ในตารางด้านล่าง</span></div>`
              : ''
        }
      </div>
      ${found ? userData(friendlyData(kind, found.data as Record<string, unknown>)) : ''}
      ${
        found
          ? snippet(
              'code ที่ใช้อ่าน และผลลัพธ์',
              `import { ${validator(kind)} } from 'promptparse/validate'\n\nconst result = ${validator(kind)}(payload)\n// คืนค่า null ถ้า payload ไม่ใช่ประเภทนี้หรือ CRC ผิด\n// result:\n${literal(found.data as Record<string, unknown>)}`,
            )
          : ''
      }
    </div>

    ${
      editable
        ? `<div class="card editor">
            <div>
              <h3><span class="user-only">เปลี่ยนจำนวนเงิน</span><span class="dev-only">ลองแก้จำนวนเงิน</span></h3>
              <p class="hint"><span class="user-only">ใส่จำนวนใหม่ แล้วจะได้ QR ใหม่ทันที ผู้รับเงินยังเป็นคนเดิม</span><span class="dev-only">ตัวอย่างการแก้ค่าใน QR ที่มีอยู่แล้ว: แยก tag ด้วย <code>parse()</code> เปลี่ยน Tag 54 (จำนวนเงิน) แล้วต่อกลับด้วย <code>encode()</code> และคำนวณ CRC ใหม่ด้วย <code>withCrcTag()</code></span></p>
              <div class="edit-row">
                <input id="edit-amount" type="number" step="0.01" min="0" inputmode="decimal" placeholder="ไม่ระบุจำนวน" value="${currentAmount ? Number(currentAmount) : ''}" />
                <span>บาท</span>
              </div>
              <div class="payload mono dev-only" id="edit-payload"></div>
              <div class="actions">
                <button class="btn dev-only" id="edit-copy">คัดลอก</button>
                <button class="btn user-only" id="edit-download">ดาวน์โหลด PNG</button>
                <button class="btn primary" id="edit-load">อ่าน QR นี้ ${ARROW}</button>
              </div>
            </div>
            <div class="qr-frame small" id="edit-qr"></div>
          </div>`
        : ''
    }

    <div class="card dev-only">
      <h3>ข้างใน payload มีอะไร</h3>
      <p class="hint">QR แบบ EMVCo เก็บข้อมูลเป็น tag ต่อกันเป็นสายเดียว แต่ละ tag มี 3 ส่วน เช่น</p>
      ${tagLegend(tags)}
      <p class="hint">ทั้ง payload แยกเป็น tag ได้ดังนี้ ในตาราง tag ที่มี tag ย่อยซ้อนอยู่จะแสดงเยื้องเข้าไป อ่านค่าใน code ได้ด้วย <code>parse(payload).getTagValue('54')</code></p>
      <div class="payload mono anatomy">${anatomy(payload)}</div>
      <div class="tag-table">
        <div class="row head"><span>ID</span><span>ชื่อ</span><span>ความยาว</span><span>ค่า</span></div>
        ${renderTagRows(tags, kind, tags)}
      </div>
    </div>`

  if (editable) {
    const input = $<HTMLInputElement>('#edit-amount')
    const update = async () => {
      const a = num(input.value)
      const next = withAmount(tags, a && a > 0 ? a : undefined)
      $('#edit-payload').innerHTML = anatomy(next)
      $('#edit-payload').dataset.raw = next
      const c = document.createElement('canvas')
      await QRCode.toCanvas(c, next, { width: 400, margin: 1, color: { dark: '#0d2236', light: '#ffffff' } })
      $('#edit-qr').replaceChildren(c)
    }
    input.addEventListener('input', update)
    $('#edit-copy').onclick = () => copy($('#edit-payload').dataset.raw ?? '', $('#edit-copy'))
    $('#edit-download').onclick = () => downloadCanvas($('#edit-qr').querySelector('canvas'), 'qr-new-amount.png')
    $('#edit-load').onclick = () => load($('#edit-payload').dataset.raw ?? '')
    update()
  }
}

function load(payload: string) {
  const ta = $<HTMLTextAreaElement>('#ins-input')
  ta.value = visible(payload)
  switchTab('inspect')
  inspect(ta.value)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

/* Highlight matching segment + row on hover */
document.addEventListener('mouseover', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tag]')
  document.querySelectorAll('.hl').forEach((x) => x.classList.remove('hl'))
  if (!el) return
  const scope = el.closest('#ins-result') ?? el.closest('.card')
  scope?.querySelectorAll(`[data-tag="${el.dataset.tag}"]`).forEach((x) => x.classList.add('hl'))
})

document.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-load]')
  if (btn) load(btn.dataset.load!)
})

/* ------------------------------------------------------------------ */
/* Image scanning                                                      */
/* ------------------------------------------------------------------ */

function scanState(state: 'idle' | 'busy' | 'error', message = '') {
  const drop = $('#drop')
  const err = $('#scan-error')
  drop.classList.toggle('busy', state === 'busy')
  drop.setAttribute('aria-busy', String(state === 'busy'))
  $('#drop-title').textContent = state === 'busy' ? 'กำลังอ่านรูป…' : 'เลือกรูป QR'
  err.textContent = message
  err.hidden = state !== 'error'
}

async function scanFile(file: File) {
  scanState('busy')
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const w = Math.round(bmp.width * scale)
    const h = Math.round(bmp.height * scale)
    const c = new OffscreenCanvas(w, h)
    const ctx = c.getContext('2d')!
    ctx.drawImage(bmp, 0, 0, w, h)
    const img = ctx.getImageData(0, 0, w, h)
    const res = jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' })
    if (!res) {
      scanState('error', 'ไม่พบ QR ในรูปนี้ ลองใช้รูปที่เห็น QR ชัดและไม่ตัดขอบ')
      return
    }
    scanState('idle')
    load(res.data)
    toast('อ่าน QR สำเร็จ')
  } catch {
    scanState('error', 'เปิดรูปนี้ไม่ได้ ลองใช้ไฟล์ PNG หรือ JPG')
  }
}

function setupScanner() {
  const drop = $('#drop')
  const file = $<HTMLInputElement>('#ins-file')
  file.addEventListener('change', () => file.files?.[0] && scanFile(file.files[0]))
  drop.addEventListener('dragover', (e) => {
    e.preventDefault()
    drop.classList.add('over')
  })
  drop.addEventListener('dragleave', () => drop.classList.remove('over'))
  drop.addEventListener('drop', (e) => {
    e.preventDefault()
    drop.classList.remove('over')
    const f = e.dataTransfer?.files?.[0]
    if (f) scanFile(f)
  })
  document.addEventListener('paste', (e) => {
    const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith('image/'))
    if (f) {
      e.preventDefault()
      scanFile(f)
    }
  })
}

/* ------------------------------------------------------------------ */
/* Tabs, samples, boot                                                 */
/* ------------------------------------------------------------------ */

function switchTab(name: string) {
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)))
  for (const id of ['generate', 'inspect']) {
    const panel = $(`#panel-${id}`)
    const show = id === name
    panel.hidden = !show
  }
  history.replaceState(null, '', name === 'inspect' ? '#inspect' : '#')
}

function setupSamples() {
  // [label, payload, developer-only]
  const samples: [string, string, boolean][] = [
    ['PromptPay', gen.anyId({ type: 'MSISDN', target: '0812345678', amount: 150 }), false],
    ['ชำระบิล', gen.billPayment({ billerId: '010554412345600', ref1: 'INV12345', ref2: 'CUST01', amount: 300 }), false],
    ['TrueMoney', gen.trueMoney({ mobileNo: '0812345678', amount: 10, message: 'ขอบคุณครับ' }), false],
    ['Barcode ชำระบิล', gen.botBarcode({ billerId: '099999999999990', ref1: '111222333444', amount: 363 }), false],
    ['Slip Verify', gen.slipVerify({ sendingBank: '002', transRef: '0002123123121200011' }), true],
    ['CRC ผิด', gen.anyId({ type: 'NATID', target: '1234567890123' }).slice(0, -4) + 'FFFF', true],
  ]
  $('#samples').innerHTML = samples
    .map(
      ([label, p, dev]) =>
        `<button class="chip${dev ? ' dev-only' : ''}" data-load="${esc(visible(p))}">${label}</button>`,
    )
    .join('')
}

/* ------------------------------------------------------------------ */
/* Theme: system / light / dark                                        */
/* ------------------------------------------------------------------ */

type Theme = 'system' | 'light' | 'dark'

const THEMES: Record<Theme, { label: string; icon: string }> = {
  system: {
    label: 'ตามระบบ',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  },
  light: {
    label: 'สว่าง',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  },
  dark: {
    label: 'มืด',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  },
}

function currentTheme(): Theme {
  const t = document.documentElement.dataset.theme
  return t === 'light' || t === 'dark' ? t : 'system'
}

function applyTheme(t: Theme) {
  if (t === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = t
  try {
    if (t === 'system') localStorage.removeItem('theme')
    else localStorage.setItem('theme', t)
  } catch {
    /* storage unavailable: theme still applies for this visit */
  }
  const btn = $<HTMLButtonElement>('#theme-btn')
  btn.innerHTML = THEMES[t].icon
  btn.setAttribute('aria-label', `Theme: ${THEMES[t].label} (กดเพื่อเปลี่ยน)`)
  btn.title = `Theme: ${THEMES[t].label}`
}

function setupTheme() {
  const order: Theme[] = ['system', 'light', 'dark']
  applyTheme(currentTheme())
  $('#theme-btn').addEventListener('click', () => {
    applyTheme(order[(order.indexOf(currentTheme()) + 1) % order.length])
  })
}

/* ------------------------------------------------------------------ */
/* Audience: user / developer                                          */
/* ------------------------------------------------------------------ */

type Audience = 'user' | 'dev'

function currentAudience(): Audience {
  return document.documentElement.dataset.audience === 'user' ? 'user' : 'dev'
}

function applyAudience(a: Audience) {
  document.documentElement.dataset.audience = a
  try {
    localStorage.setItem('audience', a)
  } catch {
    /* storage unavailable: mode still applies for this visit */
  }
  document.querySelectorAll<HTMLButtonElement>('[data-audience-btn]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.audienceBtn === a)),
  )
  // Slip-verify templates are developer tooling; fall back to the default in user mode.
  if (a === 'user' && state.template.group === 'testing') {
    state.template = templates[0]
    const radio = document.querySelector<HTMLInputElement>(`input[name="tpl"][value="${state.template.id}"]`)
    if (radio) radio.checked = true
    renderForm()
  }
}

function setupAudience() {
  applyAudience(currentAudience())
  document.querySelectorAll<HTMLButtonElement>('[data-audience-btn]').forEach((b) =>
    b.addEventListener('click', () => applyAudience(b.dataset.audienceBtn as Audience)),
  )
}

function downloadCanvas(c: HTMLCanvasElement | null, name: string) {
  if (!c) return
  const a = document.createElement('a')
  a.href = c.toDataURL('image/png')
  a.download = name
  a.click()
}

function boot() {
  setupTheme()
  $('#lib-version').textContent = `v${__LIB_VERSION__}`
  renderTemplateList()
  renderForm()
  setupAudience()
  setupSamples()
  setupScanner()

  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab!)))
  $('#gen-copy').onclick = () => state.payload && copy(state.payload, $('#gen-copy'))
  $('#install-copy').onclick = () => copy('npm i promptparse', $('#install-copy'))
  $('#gen-inspect').onclick = () => state.payload && load(state.payload)
  $('#gen-download').onclick = () => downloadCanvas($('#gen-visual').querySelector('canvas'), `${state.template.id}-qr.png`)

  const ta = $<HTMLTextAreaElement>('#ins-input')
  ta.addEventListener('input', () => inspect(ta.value))
  inspect('')

  if (location.hash === '#inspect') switchTab('inspect')
}

boot()
