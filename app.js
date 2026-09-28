// ---------------------------------------------------------------------------
// CRIF register / field browser
// ---------------------------------------------------------------------------
const MAX_RENDERED_ROWS = 500;

let crifEntries = [];

const crifFileInput = document.getElementById('crifFileInput');
const crifFileStatus = document.getElementById('crifFileStatus');
const crifFilters = document.getElementById('crifFilters');
const crifSearch = document.getElementById('crifSearch');
const crifRegisterFileSelect = document.getElementById('crifRegisterFileSelect');
const crifAccessSelect = document.getElementById('crifAccessSelect');
const crifClearBtn = document.getElementById('crifClearBtn');
const crifResultCount = document.getElementById('crifResultCount');
const crifTableWrap = document.getElementById('crifTableWrap');
const crifTableBody = document.getElementById('crifTableBody');
const crifTable = document.getElementById('crifTable');

let sortKey = null;
let sortAsc = true;

crifFileInput.addEventListener('change', handleCrifFileSelected);
crifSearch.addEventListener('input', renderCrifTable);
crifRegisterFileSelect.addEventListener('change', renderCrifTable);
crifAccessSelect.addEventListener('change', renderCrifTable);
crifClearBtn.addEventListener('click', () => {
  crifSearch.value = '';
  crifRegisterFileSelect.value = '';
  crifAccessSelect.value = '';
  renderCrifTable();
});
crifTable.querySelector('thead').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-key]');
  if (!th) return;
  const key = th.dataset.key;
  sortAsc = sortKey === key ? !sortAsc : true;
  sortKey = key;
  renderCrifTable();
});

function handleCrifFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  setCrifStatus(`Reading ${file.name}...`, '');
  const reader = new FileReader();

  reader.onerror = () => setCrifStatus('Failed to read file.', 'err');
  reader.onload = () => {
    setCrifStatus('Parsing XML...', '');
    // Defer parsing a tick so the "Parsing..." status can paint first.
    setTimeout(() => {
      try {
        crifEntries = parseCrifXml(reader.result);
        populateCrifFilterOptions(crifEntries);
        crifFilters.hidden = false;
        crifTableWrap.hidden = false;
        crifAsmControls.hidden = false;
        crifAsmOutput.hidden = true;
        setCrifStatus(`Loaded ${file.name} — ${crifEntries.length} field entries`, 'ok');
        renderCrifTable();
      } catch (err) {
        console.error(err);
        setCrifStatus(`Failed to parse ${file.name}: ${err.message}`, 'err');
      }
    }, 0);
  };
  reader.readAsText(file);
}

function setCrifStatus(text, cls) {
  crifFileStatus.textContent = text;
  crifFileStatus.className = 'crif-status' + (cls ? ` ${cls}` : '');
}

function parseCrifXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Invalid XML (parser error)');
  }

  const entries = [];
  const registerFiles = doc.querySelectorAll('crif > registerFile');

  registerFiles.forEach((rf) => {
    const rfName = childText(rf, 'name');
    // Sideband/uncore registerFiles (GPSB etc.) carry a portid + prefix used to
    // build the real eax address; core-creg registerFiles have neither.
    const portid = childText(rf, 'portid') || '';
    const prefix = childText(rf, 'prefix') || '';
    const registers = rf.querySelectorAll(':scope > register');

    registers.forEach((reg) => {
      const registerName = childText(reg, 'name');
      const fullName = childText(reg, 'fullName');
      const longName = childText(reg, 'longName');
      const addressOffset = childText(reg, 'addressOffset');
      const registerSize = childText(reg, 'size');
      const regDescription = childText(reg, 'description');
      const fields = reg.querySelectorAll(':scope > field');

      if (fields.length === 0) {
        entries.push({
          registerFile: rfName,
          portid,
          prefix,
          registerName,
          fullName,
          longName,
          addressOffset,
          registerSize,
          fieldName: '',
          access: '',
          bitOffset: '',
          bitWidth: '',
          reset: '',
          description: regDescription,
        });
        return;
      }

      fields.forEach((field) => {
        entries.push({
          registerFile: rfName,
          portid,
          prefix,
          registerName,
          fullName,
          longName,
          addressOffset,
          registerSize,
          fieldName: childText(field, 'name'),
          access: childText(field, 'access'),
          bitOffset: childText(field, 'bitOffset'),
          bitWidth: childText(field, 'bitWidth'),
          reset: childText(field, 'reset'),
          description: childText(field, 'description') || regDescription,
        });
      });
    });
  });

  return entries;
}

function childText(parent, tagName) {
  const el = parent.querySelector(`:scope > ${tagName}`);
  return el ? el.textContent.trim() : '';
}

function populateCrifFilterOptions(entries) {
  const registerFiles = [...new Set(entries.map(e => e.registerFile).filter(Boolean))].sort();
  const accesses = [...new Set(entries.map(e => e.access).filter(Boolean))].sort();

  crifRegisterFileSelect.innerHTML = '<option value="">All register files</option>' +
    registerFiles.map(rf => `<option value="${escapeAttr(rf)}">${escapeHtml(rf)}</option>`).join('');

  crifAccessSelect.innerHTML = '<option value="">Any access</option>' +
    accesses.map(a => `<option value="${escapeAttr(a)}">${escapeHtml(a)}</option>`).join('');
}

function getFilteredCrifEntries() {
  const searchTerm = crifSearch.value.trim().toLowerCase();
  const rfFilter = crifRegisterFileSelect.value;
  const accessFilter = crifAccessSelect.value;

  let filtered = crifEntries.filter((e) => {
    if (rfFilter && e.registerFile !== rfFilter) return false;
    if (accessFilter && e.access !== accessFilter) return false;
    if (searchTerm) {
      const haystack = `${e.registerName} ${e.fullName} ${e.longName} ${e.fieldName} ${e.description}`.toLowerCase();
      if (!haystack.includes(searchTerm)) return false;
    }
    return true;
  });

  if (sortKey) {
    filtered = [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      return sortAsc ? String(av).localeCompare(String(bv), undefined, { numeric: true })
                     : String(bv).localeCompare(String(av), undefined, { numeric: true });
    });
  }

  return filtered;
}

function renderCrifTable() {
  const filtered = getFilteredCrifEntries();
  const total = filtered.length;
  const rows = filtered.slice(0, MAX_RENDERED_ROWS);

  currentRenderedRows = rows;

  crifResultCount.textContent = total > MAX_RENDERED_ROWS
    ? `Showing first ${MAX_RENDERED_ROWS} of ${total} matching entries — refine filters to narrow down.`
    : `${total} matching entries`;

  crifTableBody.innerHTML = rows.map((e, i) => {
    const key = entryKey(e);
    const overrideVal = fieldValueOverrides.get(key);
    const valueForInput = overrideVal ?? e.reset;
    return `
    <tr>
      <td><input type="checkbox" name="crifFieldCheckbox" data-idx="${i}" ${selectedCrifEntries.has(key) ? 'checked' : ''}></td>
      <td>${escapeHtml(e.registerFile)}</td>
      <td>${escapeHtml(e.registerName)}<br><span style="color:var(--muted)">${escapeHtml(e.fullName)}</span></td>
      <td>${escapeHtml(e.addressOffset)}</td>
      <td>${escapeHtml(e.fieldName)}</td>
      <td>${escapeHtml(e.access)}</td>
      <td>${escapeHtml(e.bitOffset)}</td>
      <td>${escapeHtml(e.bitWidth)}</td>
      <td>${escapeHtml(e.reset)}</td>
      <td>${e.fieldName
        ? `<input type="text" class="crif-value-input${overrideVal !== undefined ? ' overridden' : ''}" data-idx="${i}" value="${escapeAttr(valueForInput)}" title="Accepts hex (0x1F), decimal (31), or binary (0b00011111)" placeholder="0x.. / 123 / 0b..">`
        : ''}</td>
      <td>${escapeHtml(e.description)}</td>
    </tr>
  `;
  }).join('');
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function escapeAttr(str) {
  return escapeHtml(str);
}

// Selection (checkboxes, persisted across re-renders/filters) for multi-field assembly generation.
let currentRenderedRows = [];
const selectedCrifEntries = new Map();
const crifSelectedFieldLabel = document.getElementById('crifSelectedFieldLabel');
const crifClearSelectionBtn = document.getElementById('crifClearSelectionBtn');
const crifResetValuesBtn = document.getElementById('crifResetValuesBtn');

// User-edited "value to write" per field, keyed by entryKey. Falls back to the
// CRIF <reset> default wherever no override is present.
const fieldValueOverrides = new Map();

function entryKey(e) {
  return `${e.registerFile}||${e.registerName}||${e.addressOffset}||${e.fieldName}`;
}

// Returns a copy of entries with <reset> replaced by any user-supplied
// override value, for feeding into registerFieldsToAsmBlock unchanged.
function withResolvedValues(entries) {
  return entries.map((e) => {
    const override = fieldValueOverrides.get(entryKey(e));
    return override === undefined ? e : { ...e, reset: override };
  });
}

crifTableBody.addEventListener('change', (e) => {
  const checkbox = e.target.closest('input[type="checkbox"][name="crifFieldCheckbox"]');
  if (!checkbox) return;
  const entry = currentRenderedRows[Number(checkbox.dataset.idx)];
  if (!entry) return;
  const key = entryKey(entry);
  if (checkbox.checked) selectedCrifEntries.set(key, entry);
  else selectedCrifEntries.delete(key);
  updateSelectedFieldStatus();
});

crifTableBody.addEventListener('input', (e) => {
  const input = e.target.closest('input.crif-value-input');
  if (!input) return;
  const entry = currentRenderedRows[Number(input.dataset.idx)];
  if (!entry) return;
  const key = entryKey(entry);
  const typed = input.value.trim();

  const parsed = typed === '' ? null : parseCrifBigInt(typed);
  const isRecognized = typed === '' || parsed !== null;
  const overflowsWidth = isRecognized && parsed !== null && !fitsInBitWidth(parsed, entry.bitWidth);
  input.classList.toggle('invalid', !isRecognized || overflowsWidth);
  input.title = overflowsWidth
    ? `${typed} doesn't fit in ${entry.bitWidth || 1}-bit field ${entry.fieldName} — it will be truncated to the low ${entry.bitWidth || 1} bits.`
    : 'Accepts hex (0x1F), decimal (31), or binary (0b00011111)';

  if (typed === '' || typed === entry.reset) {
    fieldValueOverrides.delete(key);
    input.classList.remove('overridden');
  } else {
    fieldValueOverrides.set(key, typed);
    input.classList.add('overridden');
  }
  // Keep the selection map's stored entry (if selected) in sync with the edit.
  if (selectedCrifEntries.has(key)) selectedCrifEntries.set(key, entry);
});

// True when a value fits within a field's declared bit width without
// overflowing (i.e. no silent truncation would occur when it's masked in).
function fitsInBitWidth(value, bitWidthStr) {
  const width = Math.max(1, parseInt(bitWidthStr, 10) || 1);
  const maxValue = (1n << BigInt(width)) - 1n;
  return value >= 0n && value <= maxValue;
}

crifResetValuesBtn.addEventListener('click', () => {
  fieldValueOverrides.clear();
  renderCrifTable();
});

crifClearSelectionBtn.addEventListener('click', () => {
  selectedCrifEntries.clear();
  updateSelectedFieldStatus();
  renderCrifTable();
});

function updateSelectedFieldStatus() {
  if (!crifSelectedFieldLabel) return;
  if (selectedCrifEntries.size === 0) {
    crifSelectedFieldLabel.textContent = 'No fields selected';
    return;
  }
  const names = [...selectedCrifEntries.values()]
    .map(e => e.fieldName ? `${e.registerName}.${e.fieldName}` : e.registerName);
  crifSelectedFieldLabel.textContent = `${names.length} field(s) selected: ${names.join(', ')}`;
}

// ---------------------------------------------------------------------------
// CRIF -> per-register/field assembly generation
// ---------------------------------------------------------------------------
const MAX_ASM_PREVIEW_BLOCKS = 300;

const crifAsmControls = document.getElementById('crifAsmControls');
const crifGenAsmBtn = document.getElementById('crifGenAsmBtn');
const crifGenSelectedAsmBtn = document.getElementById('crifGenSelectedAsmBtn');
const crifCopyAsmBtn = document.getElementById('crifCopyAsmBtn');
const crifDownloadAsmBtn = document.getElementById('crifDownloadAsmBtn');
const crifDownloadIncBtn = document.getElementById('crifDownloadIncBtn');
const crifAsmStatus = document.getElementById('crifAsmStatus');
const crifAsmOutput = document.getElementById('crifAsmOutput');
const crifAsmCode = document.getElementById('crifAsmCode');

crifGenAsmBtn.addEventListener('click', () => {
  const entries = getFilteredCrifEntries();
  if (entries.length === 0) {
    crifAsmStatus.textContent = 'No entries match the current filters.';
    crifAsmOutput.hidden = true;
    return;
  }

  const groups = groupEntriesByRegister(withResolvedValues(entries));
  const blocks = groups.map(registerFieldsToAsmBlock);
  const preview = blocks.slice(0, MAX_ASM_PREVIEW_BLOCKS).join('\n\n\n');
  crifAsmCode.textContent = groups.length > MAX_ASM_PREVIEW_BLOCKS
    ? `${preview}\n\n;; ... ${groups.length - MAX_ASM_PREVIEW_BLOCKS} more register block(s) omitted from preview, use "Download full .asm" for all of them.`
    : preview;
  crifAsmOutput.hidden = false;
  crifAsmStatus.textContent = `Generated ${groups.length} register block(s) from ${entries.length} field entries.`;
});

crifGenSelectedAsmBtn.addEventListener('click', () => {
  const selected = [...selectedCrifEntries.values()];
  if (selected.length === 0) {
    crifAsmStatus.textContent = 'Select one or more fields in the table first (checkbox in the "Select" column).';
    crifAsmOutput.hidden = true;
    return;
  }

  const groups = groupEntriesByRegister(withResolvedValues(selected));
  const blocks = groups.map(registerFieldsToAsmBlock);
  crifAsmCode.textContent = blocks.join('\n\n\n');
  crifAsmOutput.hidden = false;
  crifAsmStatus.textContent = `Generated ${groups.length} register block(s) from ${selected.length} selected field(s).`;
});

crifDownloadAsmBtn.addEventListener('click', () => {
  downloadFilteredAsFile('crif_register_field.asm');
});

crifDownloadIncBtn.addEventListener('click', () => {
  downloadFilteredAsFile('crif_register_field.inc');
});

crifCopyAsmBtn.addEventListener('click', async () => {
  const text = crifAsmCode.textContent;
  if (!text) {
    crifAsmStatus.textContent = 'Nothing to copy yet — generate assembly first.';
    return;
  }
  const ok = await copyTextToClipboard(text);
  crifAsmStatus.textContent = ok
    ? 'Copied to clipboard.'
    : 'Copy failed — your browser blocked clipboard access.';
});

// Builds the full (untruncated) assembly text for every filtered entry and
// triggers a browser download with the given filename (.asm and .inc share
// identical plain-text content, just a different conventional extension).
function downloadFilteredAsFile(filename) {
  const entries = getFilteredCrifEntries();
  if (entries.length === 0) {
    crifAsmStatus.textContent = 'No entries match the current filters.';
    return;
  }

  const groups = groupEntriesByRegister(withResolvedValues(entries));
  const asmText = groups.map(registerFieldsToAsmBlock).join('\n\n\n');
  const blob = new Blob([asmText], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// navigator.clipboard can be unavailable/blocked under file://, so fall back
// to a hidden-textarea + execCommand('copy') if it fails.
async function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      // fall through to the execCommand fallback below
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (err) {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}

// Converts CRIF verilog-style literals (e.g. 48'h5538, 64'h40001000200) or
// plain decimal strings into a "0x..." literal. Returns null if unparseable.
function parseIntelHexLiteral(value) {
  if (!value) return null;
  const verilogHex = /'h([0-9a-fA-F]+)/.exec(value);
  if (verilogHex) return '0x' + verilogHex[1].toLowerCase();
  if (/^0x[0-9a-fA-F]+$/i.test(value)) return value.toLowerCase();
  if (/^-?\d+$/.test(value)) return '0x' + (parseInt(value, 10) >>> 0).toString(16);
  return null;
}

// Same literal formats as parseIntelHexLiteral but returns a BigInt (or null) for bit math.
// Accepts hex (0x1F / 8'h1F), decimal (31 / 8'd31), and binary (0b00011111 / 8'b00011111).
function parseCrifBigInt(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  const verilogHex = /'h([0-9a-fA-F]+)/i.exec(trimmed);
  if (verilogHex) return BigInt('0x' + verilogHex[1]);
  const verilogBin = /'b([01]+)/i.exec(trimmed);
  if (verilogBin) return BigInt('0b' + verilogBin[1]);
  const verilogDec = /'d(\d+)/i.exec(trimmed);
  if (verilogDec) return BigInt(verilogDec[1]);
  if (/^0x[0-9a-fA-F]+$/i.test(trimmed)) return BigInt(trimmed.toLowerCase());
  if (/^0b[01]+$/i.test(trimmed)) return BigInt(trimmed.toLowerCase());
  if (/^-?\d+$/.test(trimmed)) return BigInt(trimmed);
  return null;
}

// Groups entries that share the same physical register so their fields can be
// combined into a single read-modify-write block.
function groupEntriesByRegister(entries) {
  const groups = new Map();
  entries.forEach((e) => {
    const key = `${e.registerFile}||${e.registerName}||${e.addressOffset}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  });
  return [...groups.values()];
}

// Picks the data register (edx vs rdx) for a register group: 64-bit is used
// when the CRIF <size> says so, or when any touched field spills past bit 31
// (the address register stays eax/32-bit since offsets are always small).
function pickDataRegister(entriesForRegister, declaredSize) {
  const declaredBits = parseInt(declaredSize, 10) || 32;
  const maxBitUsed = entriesForRegister.reduce((max, e) => {
    if (!e.fieldName) return max;
    const width = Math.max(1, parseInt(e.bitWidth, 10) || 1);
    const offset = parseInt(e.bitOffset, 10) || 0;
    return Math.max(max, offset + width - 1);
  }, -1);
  const is64 = declaredBits > 32 || maxBitUsed >= 32;
  return is64 ? 'rdx' : 'edx';
}

// Encodes the real eax address for GPSB/uncore sideband registers, reverse-
// engineered (and digit-for-digit verified) from a real example:
//   SANTA0 (0xEE34), CCF_SANTA0_CR_DPT_RWM (0x444) -> mov eax, 0x50340444
//   eax = (0x5 << 28) | ((portid & 0xFF) << 16) | addressOffset
// Only the low byte of the portid is encoded; the 0xEE high byte is a fixed
// prefix shared by every portid seen so far and is implied, not encoded.
function encodeSidebandAddress(portidStr, addressOffsetStr) {
  const portid = parseCrifBigInt(portidStr);
  if (portid === null) return null;
  const offset = parseCrifBigInt(addressOffsetStr) ?? 0n;
  const addr = (0x5n << 28n) | ((portid & 0xffn) << 16n) | (offset & 0xffffn);
  return '0x' + addr.toString(16).padStart(8, '0');
}

// Width-selector code for ecx on GPSB/uncore sideband accesses. Source: the
// user-supplied "Atom funny IO" numbering (mov eax, 0x18/0x48/0x50/0x58 for
// Osize8/16/32/64) - not an official doc, just the reference comment block
// they pasted, cross-checked against two real examples (DPT_RWM 4-byte ->
// ecx=0x50, REGBAR 8-byte -> ecx=0x58). Their text also lists a competing
// "Core" numbering (0xB/0x8/0x9/0xA) plus an EAX[31:24]+cmovz Atom-vs-Core
// CPU-detection sequence that is NOT implemented here since only the Atom
// numbering matched the confirmed examples.
function pickSidebandEcx(declaredSize) {
  const bytes = Math.ceil((parseInt(declaredSize, 10) || 32) / 8);
  if (bytes <= 1) return '0x18';
  if (bytes <= 2) return '0x48';
  if (bytes <= 4) return '0x50';
  return '0x58';
}

// Short human tag for a registerFile, e.g. prefix "CCF_SANTA0_" -> "SANTA0".
function deriveShortTag(prefix, fallback) {
  if (!prefix) return fallback;
  return prefix.replace(/^CCF_/, '').replace(/_+$/, '') || fallback;
}

// Builds one read-modify-write block for every field belonging to the same
// physical register (grouped by registerFile+registerName+addressOffset).
// Classification:
//  - no fields at all               -> bare read/patch/patch, nothing to set
//  - every field is exactly 1 bit   -> a bts/btr chain (bts when target=1, btr when target=0)
//  - any field is wider than 1 bit  -> a single AND/OR mask (bts/btr can't set >1 bit at once)
// "patch2"/"patch3" remain placeholder hooks for the real register-access
// sequence, filled in downstream.
//
// Registers whose registerFile carries a <portid> are GPSB/uncore sideband
// registers and use the verified encoded eax + width-selector ecx above;
// registers without a portid (e.g. core creg/MSR space) keep the plain
// ecx=0x0 / eax=addressOffset convention.
function registerFieldsToAsmBlock(entriesForRegister) {
  const first = entriesForRegister[0];
  const label = first.fullName || first.registerName || 'UNKNOWN_REGISTER';
  const rawAddressHex = parseIntelHexLiteral(first.addressOffset) ?? '0x0';
  const isSideband = !!first.portid;
  const addressHex = isSideband
    ? (encodeSidebandAddress(first.portid, first.addressOffset) ?? rawAddressHex)
    : rawAddressHex;
  const ecxHex = isSideband ? pickSidebandEcx(first.registerSize) : '0x0';
  const dataReg = pickDataRegister(entriesForRegister, first.registerSize);
  // Always place/emit fields in bit-offset order (low to high), regardless of
  // the order they were checked/selected in the table — placement into the
  // mask is by offset+width, never by selection order.
  const withFields = entriesForRegister
    .filter(e => e.fieldName)
    .slice()
    .sort((a, b) => (parseInt(a.bitOffset, 10) || 0) - (parseInt(b.bitOffset, 10) || 0));

  const header = isSideband
    ? [
      ';==================================================',
      `;${deriveShortTag(first.prefix, first.registerFile)} (${first.portid}), ${label} (${rawAddressHex})`,
    ]
    : [
      ';==================================================',
      `;${label} = ${rawAddressHex}${first.registerSize ? ` (${first.registerSize}-bit)` : ''}`,
    ];

  // Fields are sorted by offset above, so overlap only needs checking against
  // the immediately preceding field. An overlap means the combined AND/OR
  // mask would be wrong (whichever field is OR'd in last wins those bits).
  for (let i = 1; i < withFields.length; i++) {
    const prev = withFields[i - 1];
    const cur = withFields[i];
    const prevOffset = parseInt(prev.bitOffset, 10) || 0;
    const prevWidth = Math.max(1, parseInt(prev.bitWidth, 10) || 1);
    const curOffset = parseInt(cur.bitOffset, 10) || 0;
    if (curOffset < prevOffset + prevWidth) {
      header.push(`;! WARNING: ${prev.fieldName}[${prevOffset}:${prevOffset + prevWidth - 1}] overlaps ${cur.fieldName}[${curOffset}:${curOffset + Math.max(1, parseInt(cur.bitWidth, 10) || 1) - 1}] — combined value below may be wrong`);
    }
  }

  if (withFields.length === 0) {
    return [
      ...header,
      ';<no fields defined for this register>',
      `mov ecx, ${ecxHex}`,
      `mov eax, ${addressHex}`,
      `patch2`,
      `patch3`,
    ].join('\n');
  }

  const allSingleBit = withFields.every(e => (parseInt(e.bitWidth, 10) || 1) === 1);

  if (allSingleBit) {
    const lines = [...header];
    const ops = [];
    withFields.forEach((e) => {
      const bit = parseInt(e.bitOffset, 10) || 0;
      const val = (parseCrifBigInt(e.reset) ?? 0n) & 1n;
      lines.push(`;${e.fieldName}[${bit}]=${val.toString()}`);
      ops.push(`${val === 1n ? 'bts' : 'btr'} ${dataReg}, ${bit};;bit${bit}`);
    });
    lines.push(`mov ecx, ${ecxHex}`, `mov eax, ${addressHex}`, `patch2`, ...ops, `patch3`);
    return lines.join('\n');
  }

  // Mixed / multi-bit fields: combine into one AND/OR mask. The AND mask only
  // clears bits whose target value is 0 (bits going to 1 are left alone since
  // the OR forces them regardless of the prior value).
  let touchedMask = 0n;
  let orMask = 0n;
  const lines = [...header];

  withFields.forEach((e) => {
    const width = BigInt(Math.max(1, parseInt(e.bitWidth, 10) || 1));
    const offset = BigInt(parseInt(e.bitOffset, 10) || 0);
    const bitMask = (1n << width) - 1n;
    const rawVal = parseCrifBigInt(e.reset) ?? 0n;
    const maskedVal = rawVal & bitMask;

    touchedMask |= bitMask << offset;
    orMask |= maskedVal << offset;

    const bitRange = width === 1n ? `[${offset}]` : `[${offset}:${offset + width - 1n}]`;
    lines.push(`;${e.fieldName}${bitRange}=${maskedVal.toString()}`);
  });

  const regBits = dataReg === 'rdx' ? 64n : 32n;
  let totalBits = regBits;
  while (touchedMask >> totalBits) totalBits += regBits;
  const fullOnes = (1n << totalBits) - 1n;
  const clearMask = touchedMask & (fullOnes ^ orMask);
  const andMask = fullOnes ^ clearMask;
  const hexWidth = Number(totalBits / 4n);

  const andHex = '0x' + andMask.toString(16).padStart(hexWidth, '0');
  const orHex = '0x' + orMask.toString(16).padStart(hexWidth, '0');

  // When the touched fields fully tile the register (touchedMask spans every
  // bit), the AND mask equals the OR mask, and and+or degenerates into a
  // plain overwrite -> emit a single mov instead (matches the RWM0-3 style
  // example, where the whole 32-bit register is written directly).
  if (touchedMask === fullOnes) {
    lines.push(
      `mov ecx, ${ecxHex}`,
      `mov eax, ${addressHex}`,
      `patch2`,
      `mov ${dataReg}, ${orHex}`,
      `patch3`,
    );
    return lines.join('\n');
  }

  lines.push(
    `mov ecx, ${ecxHex}`,
    `mov eax, ${addressHex}`,
    `patch2`,
    `and ${dataReg},${andHex}`,
    `or ${dataReg},${orHex}`,
    `patch3`,
  );
  return lines.join('\n');
}
