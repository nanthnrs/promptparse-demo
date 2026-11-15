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

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast('คัดลอกแล้ว')
  } catch {
    toast('คัดลอกไม่สำเร็จ')
  }
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
  help?: string
}

type Template = {
  id: string
  name: string
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
    name: 'PromptPay AnyID (Tag 29)',
    hint: 'QR PromptPay ส่วนบุคคล โอนเข้าเบอร์มือถือ, เลขบัตรประชาชน / เลขผู้เสียภาษี หรือ e-wallet ID',
    kind: 'qr',
    group: 'payment',
    fields: [
      {
        key: 'type',
        label: 'ประเภท proxy',
        type: 'select',
        options: [
          { value: 'MSISDN', label: 'MSISDN: เบอร์มือถือ' },
          { value: 'NATID', label: 'NATID: เลขบัตรประชาชน / เลขผู้เสียภาษี' },
          { value: 'EWALLETID', label: 'EWALLETID: e-wallet ID' },
        ],
        value: 'MSISDN',
      },
      { key: 'target', label: 'ผู้รับเงิน', placeholder: '0812345678', value: '0812345678' },
      { key: 'amount', label: 'จำนวนเงิน (บาท)', type: 'number', placeholder: 'ไม่ระบุจำนวน', optional: true, value: '150' },
    ],
    run: (v) => gen.anyId({ type: v.type as any, target: v.target.trim(), amount: num(v.amount) }),
    code: (v) =>
      `import { anyId } from 'promptparse/generate'\n\nanyId(${objLiteral({ type: v.type, target: v.target.trim(), amount: num(v.amount) })})`,
  },
  {
    id: 'billPayment',
    name: 'PromptPay Bill Payment (Tag 30)',
    hint: 'QR ชำระบิลของร้านค้า ใช้ biller ID (เลขผู้เสียภาษี + suffix) และเลขอ้างอิง',
    kind: 'qr',
    group: 'payment',
    fields: [
      { key: 'billerId', label: 'Biller ID', placeholder: '010554412345600', value: '010554412345600' },
      { key: 'ref1', label: 'เลขอ้างอิง 1', placeholder: 'INV12345', value: 'INV12345' },
      { key: 'ref2', label: 'เลขอ้างอิง 2', optional: true, placeholder: 'ไม่บังคับ' },
      { key: 'ref3', label: 'เลขอ้างอิง 3', optional: true, placeholder: 'ไม่บังคับ (ไม่มีใน spec, Tag 62.07)' },
      { key: 'amount', label: 'จำนวนเงิน (บาท)', type: 'number', optional: true, placeholder: 'ไม่ระบุจำนวน', value: '300' },
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
    name: 'TrueMoney Wallet',
    hint: 'QR TrueMoney แอปธนาคารอื่นสแกนได้เหมือน QR PromptPay แบบ e-wallet แต่จะไม่เห็นข้อความ (Tag 81)',
    kind: 'qr',
    group: 'payment',
    fields: [
      { key: 'mobileNo', label: 'เบอร์มือถือ', placeholder: '0812345678', value: '0812345678' },
      { key: 'amount', label: 'จำนวนเงิน (บาท)', type: 'number', optional: true, placeholder: 'ไม่ระบุจำนวน', value: '10' },
      { key: 'message', label: 'ข้อความ', optional: true, placeholder: 'ขอบคุณครับ', value: 'ขอบคุณครับ' },
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
    name: 'BOT Barcode',
    hint: 'Barcode ชำระบิลตามมาตรฐานธนาคารแห่งประเทศไทย (ข้อมูล Code 128) แปลงเป็น QR Tag 30 ได้ในหน้าตรวจ',
    kind: 'barcode',
    group: 'payment',
    fields: [
      { key: 'billerId', label: 'Biller ID', placeholder: '099999999999990', value: '099999999999990' },
      { key: 'ref1', label: 'เลขอ้างอิง 1', placeholder: '111222333444', value: '111222333444' },
      { key: 'ref2', label: 'เลขอ้างอิง 2', optional: true, placeholder: 'ไม่บังคับ' },
      { key: 'amount', label: 'จำนวนเงิน (บาท)', type: 'number', optional: true, placeholder: 'เว้นว่าง = ไม่ระบุ', value: '363' },
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
    name: 'Slip Verify (Mini QR)',
    hint: 'QR เล็กๆ บนสลิปโอนเงิน มีแค่รหัสธนาคารกับเลขอ้างอิง ใช้ทดสอบระบบตรวจสลิปที่ต่อกับ Bank Open API เท่านั้น ไม่ใช่ QR ชำระเงิน',
    kind: 'qr',
    group: 'testing',
    fields: [
      { key: 'sendingBank', label: 'รหัสธนาคารผู้โอน', placeholder: '002', value: '002' },
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
    name: 'TrueMoney Slip Verify',
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

function renderTemplateSelect() {
  const sel = $<HTMLSelectElement>('#template')
  const groups: [Template['group'], string][] = [
    ['payment', 'QR / barcode รับเงิน'],
    ['testing', 'สำหรับทดสอบระบบตรวจสลิป'],
  ]
  sel.innerHTML = groups
    .map(
      ([g, label]) =>
        `<optgroup label="${esc(label)}">${templates
          .filter((t) => t.group === g)
          .map((t) => `<option value="${t.id}">${esc(t.name)}</option>`)
          .join('')}</optgroup>`,
    )
    .join('')
  sel.addEventListener('change', () => {
    state.template = templates.find((t) => t.id === sel.value)!
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
      if (f.type === 'select') {
        return `<label class="field">${label}<select name="${f.key}">${f.options!
          .map((o) => `<option value="${o.value}"${o.value === f.value ? ' selected' : ''}>${esc(o.label)}</option>`)
          .join('')}</select></label>`
      }
      return `<label class="field">${label}<input name="${f.key}" ${
        f.type === 'number' ? 'type="number" step="0.01" min="0" inputmode="decimal"' : 'type="text"'
      } placeholder="${esc(f.placeholder ?? '')}" value="${esc(f.value ?? '')}" /></label>`
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
  $('#gen-code').textContent = t.code(v)
  try {
    const missing = t.fields.filter((f) => !f.optional && !v[f.key].trim())
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
      return `<span class="seg h${i % 6}" data-tag="${t.id}"><b>${t.id}</b><i>${len}</i>${esc(t.value)}</span>`
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

function renderData(data: unknown) {
  const entries = Object.entries(data as Record<string, unknown>).filter(([, v]) => v !== undefined)
  return `<dl class="kv">${entries
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="mono">${esc(String(v))}</dd></div>`)
    .join('')}</dl>`
}


function inspect(raw: string) {
  const out = $('#ins-result')
  const payload = raw.replace(/\\r/g, '\r').trim()
  if (!payload) {
    out.innerHTML = `<div class="empty">วาง payload, สแกนจากรูป หรือเลือกตัวอย่าง เพื่อดู tag ทั้งหมด</div>`
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
        <div class="verdict ok"><span class="pill">BOT Barcode</span> อ่านด้วย <code>parseBarcode()</code></div>
        ${renderData({ billerId: bc.billerId, ref1: bc.ref1, ref2: bc.ref2 ?? '(ไม่มี)', amount: bc.amount ?? '(ไม่ระบุ)' })}
      </div>
      <div class="card convert">
        <div>
          <h3>แปลงเป็น PromptPay Tag 30</h3>
          <p class="hint">ได้จาก <code>barcode.toQrTag30()</code> ใช้ได้หรือไม่ขึ้นกับธนาคารของผู้รับชำระ</p>
          <div class="payload mono">${anatomy(qr)}</div>
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
      <div class="verdicts">
        ${
          crc
            ? crc.ok
              ? `<div class="verdict ok"><span class="pill">CRC ${crc.id} OK</span> checksum <code>${crc.actual}</code> ถูกต้อง</div>`
              : `<div class="verdict bad"><span class="pill">CRC ${crc.id} ไม่ตรง</span> พบ <code>${esc(crc.actual)}</code> แต่ที่ถูกคือ <code>${crc.expected}</code> <button class="link" data-load="${esc(payload.slice(0, -4) + crc.expected)}">แก้ให้ถูก</button></div>`
            : `<div class="verdict warn"><span class="pill">ไม่มี CRC</span> ไม่พบ CRC tag (63 หรือ 91) ท้ายข้อมูล</div>`
        }
        ${
          found
            ? `<div class="verdict ok"><span class="pill">${esc(found.label)}</span> ตรวจพบด้วย <code>validate.${kind === 'trueMoney' ? 'anyId' : kind}()</code></div>`
            : crc?.ok
              ? `<div class="verdict warn"><span class="pill">EMVCo ทั่วไป</span> TLV ถูกต้อง แต่ไม่ตรงกับรูปแบบที่รู้จัก</div>`
              : ''
        }
      </div>
      ${found ? renderData(found.data) : ''}
    </div>

    ${
      editable
        ? `<div class="card editor">
            <div>
              <h3>แก้ไขจำนวนเงิน</h3>
              <p class="hint">เขียน Tag 54 และ Tag 01 ใหม่ แล้วคำนวณ CRC ใหม่ด้วย <code>encode()</code> และ <code>withCrcTag()</code></p>
              <div class="edit-row">
                <input id="edit-amount" type="number" step="0.01" min="0" inputmode="decimal" placeholder="ไม่ระบุจำนวน" value="${currentAmount ? Number(currentAmount) : ''}" />
                <span>บาท</span>
              </div>
              <div class="payload mono" id="edit-payload"></div>
              <div class="actions">
                <button class="btn" id="edit-copy">คัดลอก</button>
                <button class="btn primary" id="edit-load">ตรวจผลลัพธ์ ${ARROW}</button>
              </div>
            </div>
            <div class="qr-frame small" id="edit-qr"></div>
          </div>`
        : ''
    }

    <div class="card">
      <h3>รายการ tag</h3>
      <div class="payload mono anatomy">${anatomy(payload)}</div>
      <div class="tag-table">
        <div class="row head"><span>ID</span><span>ชื่อ</span><span>ยาว</span><span>ค่า</span></div>
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
    $('#edit-copy').onclick = () => copy($('#edit-payload').dataset.raw ?? '')
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

async function scanFile(file: File) {
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
      toast('ไม่พบ QR code ในรูปนี้')
      return
    }
    load(res.data)
    toast('อ่าน QR สำเร็จ')
  } catch {
    toast('อ่านรูปนี้ไม่ได้')
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
  $('#panel-generate').hidden = name !== 'generate'
  $('#panel-inspect').hidden = name !== 'inspect'
  history.replaceState(null, '', name === 'inspect' ? '#inspect' : '#')
}

function setupSamples() {
  const samples: [string, string][] = [
    ['AnyID', gen.anyId({ type: 'MSISDN', target: '0812345678', amount: 150 })],
    ['Bill Payment', gen.billPayment({ billerId: '010554412345600', ref1: 'INV12345', ref2: 'CUST01', amount: 300 })],
    ['TrueMoney', gen.trueMoney({ mobileNo: '0812345678', amount: 10, message: 'ขอบคุณครับ' })],
    ['Slip Verify', gen.slipVerify({ sendingBank: '002', transRef: '0002123123121200011' })],
    ['BOT Barcode', gen.botBarcode({ billerId: '099999999999990', ref1: '111222333444', amount: 363 })],
    ['CRC ผิด', gen.anyId({ type: 'NATID', target: '1234567890123' }).slice(0, -4) + 'FFFF'],
  ]
  $('#samples').innerHTML = samples
    .map(([label, p]) => `<button class="chip" data-load="${esc(visible(p))}">${label}</button>`)
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
  btn.innerHTML = `${THEMES[t].icon}<span>${THEMES[t].label}</span>`
  btn.setAttribute('aria-label', `Theme: ${THEMES[t].label} (กดเพื่อเปลี่ยน)`)
}

function setupTheme() {
  const order: Theme[] = ['system', 'light', 'dark']
  applyTheme(currentTheme())
  $('#theme-btn').addEventListener('click', () => {
    applyTheme(order[(order.indexOf(currentTheme()) + 1) % order.length])
  })
}

function boot() {
  setupTheme()
  $('#lib-version').textContent = `v${__LIB_VERSION__}`
  renderTemplateSelect()
  renderForm()
  setupSamples()
  setupScanner()

  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab!)))
  $('#gen-copy').onclick = () => state.payload && copy(state.payload)
  $('#gen-inspect').onclick = () => state.payload && load(state.payload)
  $('#gen-download').onclick = () => {
    const c = $('#gen-visual').querySelector('canvas')
    if (!c) return
    const a = document.createElement('a')
    a.href = c.toDataURL('image/png')
    a.download = `${state.template.id}-qr.png`
    a.click()
  }

  const ta = $<HTMLTextAreaElement>('#ins-input')
  ta.addEventListener('input', () => inspect(ta.value))
  inspect('')

  if (location.hash === '#inspect') switchTab('inspect')
}

boot()
