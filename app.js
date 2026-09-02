(() => {
  "use strict";

  const source = window.MATERIAL_DATA;
  const mappings = source.mappings || [];
  const specs = source.specs || [];
  const damageOptions = [...new Set(mappings.map((item) => item.damage))].sort();
  const specByName = new Map(specs.map((item) => [item.name, item]));
  const FIREBASE_DB_URL = "https://repairmaterial-4e4bc-default-rtdb.asia-southeast1.firebasedatabase.app";
  const FIREBASE_RECORDS_PATH = "repairRecords";
  const STORAGE_KEY = "containerRepairMaterials.records.v1";
  const LOCAL_RESET_KEY = "containerRepairMaterials.firebaseReset.v1";

  const elements = {
    containerNumber: document.querySelector("#container-number"),
    shippingLine: document.querySelector("#shipping-line"),
    repairDate: document.querySelector("#repair-date"),
    laborCost: document.querySelector("#labor-cost"),
    materialCost: document.querySelector("#material-cost"),
    wWash: document.querySelector("#w-wash"),
    totalCost: document.querySelector("#total-cost"),
    damageList: document.querySelector("#damage-list"),
    damageOptions: document.querySelector("#damage-options"),
    addDamage: document.querySelector("#add-damage"),
    saveRecord: document.querySelector("#save-record"),
    selectedDamageCount: document.querySelector("#selected-damage-count"),
    materialLineCount: document.querySelector("#material-line-count"),
    recordsList: document.querySelector("#records-list"),
    recordCount: document.querySelector("#record-count"),
    syncStatus: document.querySelector("#sync-status"),
    refreshRecords: document.querySelector("#refresh-records"),
    exportExcel: document.querySelector("#export-excel"),
    printRecords: document.querySelector("#print-records"),
    filterFrom: document.querySelector("#filter-from"),
    filterTo: document.querySelector("#filter-to"),
    clearFilter: document.querySelector("#clear-filter"),
    filterResult: document.querySelector("#filter-result"),
    editNotice: document.querySelector("#edit-notice"),
    cancelEdit: document.querySelector("#cancel-edit"),
    toast: document.querySelector("#toast"),
  };

  let state = {
    damages: [newDamage()],
    repairs: [],
    recordsLoaded: false,
    recordsLoading: false,
    saving: false,
    editingId: null,
    filters: { from: "", to: "" },
  };
  let toastTimer;

  function createId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function defaultRepairDate() {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
  }

  function newDamage() {
    return {
      id: createId(),
      damage: "",
      quantity: 1,
      materials: [],
    };
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatQuantity(value) {
    return Number(Number(value).toFixed(4)).toLocaleString(undefined, {
      maximumFractionDigits: 4,
    });
  }

  function numberValue(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  function optionalNumber(value) {
    return String(value ?? "").trim() === "" ? "" : numberValue(value);
  }

  function formatCost(value) {
    return numberValue(value).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function updateCostTotal() {
    const total =
      numberValue(elements.laborCost.value) +
      numberValue(elements.materialCost.value) +
      numberValue(elements.wWash.value);
    elements.totalCost.textContent = formatCost(total);
  }

  function showToast(message, kind = "") {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.className = `toast show ${kind}`.trim();
    toastTimer = setTimeout(() => {
      elements.toast.className = "toast";
    }, 3600);
  }

  function setSyncStatus(message, kind = "") {
    if (!elements.syncStatus) return;
    elements.syncStatus.textContent = message;
    elements.syncStatus.className = `sync-status ${kind}`.trim();
  }

  function clearLegacyLocalRecords() {
    try {
      if (!localStorage.getItem(LOCAL_RESET_KEY)) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.setItem(LOCAL_RESET_KEY, "1");
      }
    } catch {
      // Local storage is only used for the one-time migration marker.
    }
  }

  function firebaseUrl(id = "") {
    const suffix = id ? `/${encodeURIComponent(id)}` : "";
    return `${FIREBASE_DB_URL}/${FIREBASE_RECORDS_PATH}${suffix}.json`;
  }

  function recordsQueryUrl() {
    const params = new URLSearchParams();
    params.set("orderBy", JSON.stringify("repairDate"));
    if (state.filters.from) params.set("startAt", JSON.stringify(state.filters.from));
    if (state.filters.to) params.set("endAt", JSON.stringify(state.filters.to));
    if (!state.filters.from && !state.filters.to) params.set("limitToLast", "1");
    return `${FIREBASE_DB_URL}/${FIREBASE_RECORDS_PATH}.json?${params.toString()}`;
  }

  async function firebaseRequest(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {}),
      },
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // Some successful Firebase requests have an empty response body.
    }
    if (!response.ok) {
      const reason = payload && typeof payload === "object" ? payload.error : "";
      throw new Error(reason || `Firebase request failed (${response.status}).`);
    }
    return payload;
  }

  function recordsFromFirebase(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
    return Object.entries(payload)
      .map(([id, record]) => ({ ...(record || {}), id: record?.id || id }))
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }

  function materialsForDamage(damage) {
    return mappings
      .filter((item) => item.damage === damage)
      .map((item) => ({
        ...item,
        id: createId(),
        specName: "",
        specItemCode: "",
      }));
  }

  function specOptionsHtml(selected) {
    return [
      '<option value="">Select specification</option>',
      ...specs
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(
          (spec) =>
            `<option value="${escapeHtml(spec.name)}" ${spec.name === selected ? "selected" : ""}>${escapeHtml(spec.name)}</option>`,
        ),
    ].join("");
  }

  function materialTable(entry) {
    if (!entry.materials.length) {
      return `
        <div class="empty-materials">
          <div><strong>Select a damage to load its materials.</strong><span>Material requirements will appear automatically.</span></div>
        </div>`;
    }

    const rows = entry.materials
      .map((material) => {
        const requiredQuantity = material.rate * (entry.quantity || 0);
        const materialCode = material.itemCode
          ? `<span class="code-badge">${escapeHtml(material.itemCode)}</span>`
          : '<span class="muted">From specs</span>';
        const specification = `<select class="spec-select" data-action="spec" data-damage-id="${entry.id}" data-material-id="${material.id}">${specOptionsHtml(material.specName)}</select>`;
        const specCode = material.specItemCode
          ? `<span class="code-badge spec">${escapeHtml(material.specItemCode)}</span>`
          : '<span class="muted">—</span>';

        return `
          <tr>
            <td class="material-name">${escapeHtml(material.material)}<small>Rate: ${formatQuantity(material.rate)} × ${formatQuantity(entry.quantity || 0)}</small></td>
            <td><span class="qty-badge">${formatQuantity(requiredQuantity)}</span></td>
            <td>${materialCode}</td>
            <td>${specification}</td>
            <td>${specCode}</td>
          </tr>`;
      })
      .join("");

    return `
      <div class="material-wrap">
        <table>
          <thead><tr><th>Material Used</th><th>Auto Qty</th><th>Material Code</th><th>Material Specs</th><th>Specs Code</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function renderDamages() {
    elements.damageList.innerHTML = state.damages
      .map(
        (entry, index) => `
          <article class="damage-card" data-damage-card="${entry.id}">
            <div class="damage-head">
              <div class="damage-field">
                <div class="damage-label"><span class="damage-number">${index + 1}</span><label for="damage-${entry.id}">Damage</label></div>
                <input id="damage-${entry.id}" data-action="damage" data-id="${entry.id}" list="damage-options" value="${escapeHtml(entry.damage)}" placeholder="Search and select damage" autocomplete="off">
              </div>
              <div class="damage-field">
                <label for="qty-${entry.id}">Damage Qty</label>
                <input id="qty-${entry.id}" data-action="quantity" data-id="${entry.id}" type="number" min="0.01" step="0.01" value="${entry.quantity}">
              </div>
              <button class="button danger" data-action="remove" data-id="${entry.id}" type="button" aria-label="Remove damage" ${state.damages.length === 1 ? "disabled" : ""}>✕</button>
            </div>
            ${materialTable(entry)}
          </article>`,
      )
      .join("");
    updateSummary();
  }

  function updateSummary() {
    const selected = state.damages.filter((item) => item.damage).length;
    const materialLines = state.damages.reduce(
      (total, item) => total + item.materials.length,
      0,
    );
    elements.selectedDamageCount.textContent = String(selected);
    elements.materialLineCount.textContent = String(materialLines);
  }

  function chooseDamage(id, damage) {
    const entry = state.damages.find((item) => item.id === id);
    if (!entry) return;
    entry.damage = damage;
    entry.materials = materialsForDamage(damage);
    renderDamages();
  }

  function changeQuantity(id, value) {
    const entry = state.damages.find((item) => item.id === id);
    if (!entry) return;
    entry.quantity = Number.isFinite(value) ? value : 0;
    renderDamages();
  }

  function chooseSpec(damageId, materialId, specName) {
    const entry = state.damages.find((item) => item.id === damageId);
    const material = entry?.materials.find((item) => item.id === materialId);
    if (!material) return;
    material.specName = specName;
    material.specItemCode = specByName.get(specName)?.itemCode || "";
    renderDamages();
  }

  function resetForm() {
    elements.containerNumber.value = "";
    elements.shippingLine.value = "";
    elements.repairDate.value = defaultRepairDate();
    elements.laborCost.value = "";
    elements.materialCost.value = "";
    elements.wWash.value = "";
    state.damages = [newDamage()];
    state.editingId = null;
    elements.editNotice.hidden = true;
    elements.saveRecord.textContent = "▣ Save Repair Record";
    updateCostTotal();
    renderDamages();
  }

  function buildPayload() {
    return {
      containerNumber: elements.containerNumber.value.trim().toUpperCase(),
      shippingLine: elements.shippingLine.value,
      repairDate: elements.repairDate.value,
      costs: {
        labor: optionalNumber(elements.laborCost.value),
        material: optionalNumber(elements.materialCost.value),
        wWash: optionalNumber(elements.wWash.value),
      },
      damages: state.damages
        .filter((entry) => entry.damage || entry.materials.length)
        .map((entry) => ({
          damage: entry.damage,
          quantity: entry.quantity,
          materials: entry.materials.map((material) => ({
            material: material.material,
            materialQuantity: Number((material.rate * entry.quantity).toFixed(4)),
            materialItemCode: material.itemCode,
            materialSpec: material.specName,
            specItemCode: material.specItemCode,
          })),
        })),
    };
  }

  async function saveRecord() {
    if (state.saving) return;
    const payload = buildPayload();

    state.saving = true;
    elements.saveRecord.disabled = true;
    elements.saveRecord.textContent = "Saving…";
    try {
      const existing = state.repairs.find((item) => item.id === state.editingId);
      const record = {
        ...payload,
        id: state.editingId || createId(),
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: state.editingId ? new Date().toISOString() : "",
      };
      await firebaseRequest(firebaseUrl(record.id), {
        method: "PUT",
        body: JSON.stringify(record),
      });
      showToast(
        state.editingId ? "Repair record updated in Firebase." : "Repair record saved to Firebase.",
        "success",
      );
      setSyncStatus("Firebase: connected", "success");
      resetForm();
      state.recordsLoaded = false;
      await loadRecords();
      showTab("records");
    } catch (error) {
      setSyncStatus("Firebase: unavailable", "error");
      showToast(error.message || "Unable to save to Firebase.", "error");
    } finally {
      state.saving = false;
      elements.saveRecord.disabled = false;
      if (!state.editingId) elements.saveRecord.textContent = "▣ Save Repair Record";
    }
  }

  function editableDamage(savedDamage) {
    const quantity = numberValue(savedDamage.quantity);
    return {
      id: createId(),
      damage: savedDamage.damage || "",
      quantity,
      materials: (savedDamage.materials || []).map((savedMaterial) => {
        const mapped = mappings.find(
          (item) =>
            item.damage === savedDamage.damage && item.material === savedMaterial.material,
        );
        const rate = mapped?.rate ?? (quantity ? numberValue(savedMaterial.materialQuantity) / quantity : 0);
        return {
          id: createId(),
          damage: savedDamage.damage || "",
          material: savedMaterial.material || mapped?.material || "",
          rate,
          itemCode: savedMaterial.materialItemCode || mapped?.itemCode || "",
          specName: savedMaterial.materialSpec || "",
          specItemCode: savedMaterial.specItemCode || "",
        };
      }),
    };
  }

  function editRecord(recordId) {
    const repair = state.repairs.find((item) => item.id === recordId);
    if (!repair) return;
    state.editingId = repair.id;
    elements.containerNumber.value = repair.containerNumber || "";
    elements.shippingLine.value = repair.shippingLine || "";
    elements.repairDate.value = repair.repairDate || "";
    elements.laborCost.value = repair.costs?.labor ?? "";
    elements.materialCost.value = repair.costs?.material ?? "";
    elements.wWash.value = repair.costs?.wWash ?? "";
    state.damages = repair.damages?.length
      ? repair.damages.map(editableDamage)
      : [newDamage()];
    elements.editNotice.hidden = false;
    elements.saveRecord.textContent = "✓ Update Repair Record";
    updateCostTotal();
    renderDamages();
    showTab("entry");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function recordRows(repair) {
    const rows = (repair.damages || [])
      .flatMap((damage) =>
        (damage.materials || []).map(
          (material, index) => `
            <tr>
              <td>${index === 0 ? escapeHtml(damage.damage) : ""}</td>
              <td>${index === 0 ? formatQuantity(damage.quantity) : ""}</td>
              <td>${escapeHtml(material.material)}</td>
              <td><strong>${formatQuantity(material.materialQuantity)}</strong></td>
              <td>${escapeHtml(material.materialSpec || "—")}</td>
              <td>${escapeHtml(material.materialItemCode || material.specItemCode || "—")}</td>
            </tr>`,
        ),
      )
      .join("");
    return rows || '<tr><td colspan="6" class="empty-row">No damage or material information saved.</td></tr>';
  }

  function filteredRecords() {
    return state.repairs.filter((repair) => {
      if (state.filters.from && (!repair.repairDate || repair.repairDate < state.filters.from)) return false;
      if (state.filters.to && (!repair.repairDate || repair.repairDate > state.filters.to)) return false;
      return true;
    });
  }

  function recordCostTotal(repair) {
    return (
      numberValue(repair.costs?.labor) +
      numberValue(repair.costs?.material) +
      numberValue(repair.costs?.wWash)
    );
  }

  function renderRecords() {
    const visibleRecords = filteredRecords();
    elements.recordCount.hidden = state.repairs.length === 0;
    elements.recordCount.textContent = String(state.repairs.length);
    const filterActive = Boolean(state.filters.from || state.filters.to);
    elements.filterResult.textContent = filterActive
      ? `Showing ${visibleRecords.length} saved record${visibleRecords.length === 1 ? "" : "s"} for the selected date range.`
      : `${state.repairs.length ? "Latest saved record" : "No saved records"}.`;
    elements.exportExcel.disabled = visibleRecords.length === 0;

    if (!visibleRecords.length) {
      elements.recordsList.innerHTML = state.repairs.length
        ? '<div class="state-card"><strong>No records match this date range.</strong><br>Change or clear the date filter.</div>'
        : '<div class="state-card"><strong>No repair records yet.</strong><br>Your first saved entry will appear here.</div>';
      return;
    }

    elements.recordsList.innerHTML = visibleRecords
      .map((repair) => {
        const damages = repair.damages || [];
        const materialCount = damages.reduce(
          (total, damage) => total + (damage.materials || []).length,
          0,
        );
        const costTotal = recordCostTotal(repair);
        return `
          <details class="record-card">
            <summary>
              <div class="record-main">
                <div class="record-icon" aria-hidden="true">▣</div>
                <div><strong>${escapeHtml(repair.containerNumber || "No container number")}</strong><span>${escapeHtml(repair.shippingLine || "No shipping line")} · ${escapeHtml(repair.repairDate || "No date")}</span></div>
              </div>
              <div class="record-tags"><span>${damages.length} damage${damages.length === 1 ? "" : "s"}</span><span>${materialCount} material lines</span><span>Total ${formatCost(costTotal)}</span></div>
            </summary>
            <div class="record-toolbar">
              <div class="cost-chips">
                <span>Labor <strong>${repair.costs?.labor === "" || repair.costs?.labor == null ? "—" : formatCost(repair.costs.labor)}</strong></span>
                <span>Material <strong>${repair.costs?.material === "" || repair.costs?.material == null ? "—" : formatCost(repair.costs.material)}</strong></span>
                <span>W. Wash <strong>${repair.costs?.wWash === "" || repair.costs?.wWash == null ? "—" : formatCost(repair.costs.wWash)}</strong></span>
              </div>
              <button class="button edit" type="button" data-action="edit-record" data-id="${escapeHtml(repair.id)}">✎ Edit Record</button>
            </div>
            <div class="record-table">
              <table>
                <thead><tr><th>Damage</th><th>Damage Qty</th><th>Material Used</th><th>Material Qty</th><th>Material Specs</th><th>Item Code</th></tr></thead>
                <tbody>${recordRows(repair)}</tbody>
              </table>
            </div>
          </details>`;
      })
      .join("");
  }

  function escapeXml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;");
  }

  function excelColumn(index) {
    let name = "";
    let value = index;
    while (value > 0) {
      value -= 1;
      name = String.fromCharCode(65 + (value % 26)) + name;
      value = Math.floor(value / 26);
    }
    return name;
  }

  function excelDateSerial(dateText) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText || "");
    if (!match) return "";
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000 + 25569;
  }

  function excelCell(reference, value, style) {
    if (value === "" || value == null) return `<c r="${reference}" s="${style}"/>`;
    if (typeof value === "number" && Number.isFinite(value)) {
      return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
    }
    return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  }

  function excelRow(rowNumber, values, styles, height = "") {
    const cells = values
      .map((value, index) => excelCell(`${excelColumn(index + 1)}${rowNumber}`, value, styles[index] ?? 0))
      .join("");
    const heightAttributes = height ? ` ht="${height}" customHeight="1"` : "";
    return `<row r="${rowNumber}"${heightAttributes}>${cells}</row>`;
  }

  function buildWorksheet(records) {
    const headings = [
      "Container Number", "Shipping Line", "Repair Date", "Damage", "Damage Qty",
      "Material Used", "Material Qty", "Material Specs", "Item Code",
      "Labor Cost", "Material Cost", "W. Wash", "Total Cost",
    ];
    const rows = [
      excelRow(1, ["CONTAINER REPAIR MATERIALS REPORT", ...Array(12).fill("")], Array(13).fill(1), 28),
      excelRow(
        2,
        [`Repair date: ${state.filters.from || "All dates"} to ${state.filters.to || "All dates"}  •  ${records.length} record${records.length === 1 ? "" : "s"}`, ...Array(12).fill("")],
        Array(13).fill(2),
        21,
      ),
      excelRow(3, headings, Array(13).fill(3), 34),
    ];
    const merges = ["A1:M1", "A2:M2"];
    const dataStyles = [4, 4, 8, 4, 6, 4, 6, 4, 4, 7, 7, 7, 7];
    let rowNumber = 4;

    records.forEach((repair) => {
      const recordStart = rowNumber;
      const repairRows = [];
      const damageMerges = [];
      const damages = repair.damages || [];

      if (!damages.length) {
        repairRows.push({ damage: null, material: null, firstDamageRow: true });
      } else {
        damages.forEach((damage) => {
          const materials = damage.materials?.length ? damage.materials : [null];
          const damageStartOffset = repairRows.length;
          materials.forEach((material, index) => {
            repairRows.push({ damage, material, firstDamageRow: index === 0 });
          });
          if (materials.length > 1) {
            damageMerges.push([damageStartOffset, damageStartOffset + materials.length - 1]);
          }
        });
      }

      repairRows.forEach((line, index) => {
        const firstRecordRow = index === 0;
        const values = [
          firstRecordRow ? repair.containerNumber || "" : "",
          firstRecordRow ? repair.shippingLine || "" : "",
          firstRecordRow ? excelDateSerial(repair.repairDate) : "",
          line.firstDamageRow ? line.damage?.damage || "" : "",
          line.firstDamageRow ? line.damage?.quantity ?? "" : "",
          line.material?.material || "",
          line.material?.materialQuantity ?? "",
          line.material?.materialSpec || "",
          line.material?.materialItemCode || line.material?.specItemCode || "",
          firstRecordRow ? repair.costs?.labor ?? "" : "",
          firstRecordRow ? repair.costs?.material ?? "" : "",
          firstRecordRow ? repair.costs?.wWash ?? "" : "",
          firstRecordRow ? recordCostTotal(repair) : "",
        ];
        rows.push(excelRow(rowNumber, values, dataStyles));
        rowNumber += 1;
      });

      const recordEnd = rowNumber - 1;
      if (recordEnd > recordStart) {
        ["A", "B", "C", "J", "K", "L", "M"].forEach((column) => {
          merges.push(`${column}${recordStart}:${column}${recordEnd}`);
        });
      }
      damageMerges.forEach(([startOffset, endOffset]) => {
        ["D", "E"].forEach((column) => {
          merges.push(`${column}${recordStart + startOffset}:${column}${recordStart + endOffset}`);
        });
      });
    });

    const lastDataRow = rowNumber - 1;
    rows.push(
      `<row r="${rowNumber}" ht="23" customHeight="1"><c r="A${rowNumber}" s="9" t="inlineStr"><is><t>GRAND TOTAL</t></is></c>${Array.from({ length: 11 }, (_, index) => `<c r="${excelColumn(index + 2)}${rowNumber}" s="9"/>`).join("")}<c r="M${rowNumber}" s="10"><f>SUM(M4:M${lastDataRow})</f><v>0</v></c></row>`,
    );
    merges.push(`A${rowNumber}:L${rowNumber}`);

    const mergeXml = merges.map((range) => `<mergeCell ref="${range}"/>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><pageSetUpPr fitToPage="1" autoPageBreaks="0"/></sheetPr>
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="19"/>
  <cols>
    <col min="1" max="1" width="18" customWidth="1"/><col min="2" max="2" width="16" customWidth="1"/>
    <col min="3" max="3" width="14" customWidth="1"/><col min="4" max="4" width="34" customWidth="1"/>
    <col min="5" max="5" width="13" customWidth="1"/><col min="6" max="6" width="30" customWidth="1"/>
    <col min="7" max="7" width="14" customWidth="1"/><col min="8" max="8" width="32" customWidth="1"/>
    <col min="9" max="9" width="17" customWidth="1"/><col min="10" max="13" width="15" customWidth="1"/>
  </cols>
  <sheetData>${rows.join("")}</sheetData>
  <autoFilter ref="A3:M${lastDataRow}"/>
  <mergeCells count="${merges.length}">${mergeXml}</mergeCells>
  <printOptions horizontalCentered="1" verticalCentered="0"/>
  <pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
  }

  function crc32(bytes) {
    if (!crc32.table) {
      crc32.table = Array.from({ length: 256 }, (_, index) => {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
          value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        return value >>> 0;
      });
    }
    let crc = 0xffffffff;
    bytes.forEach((byte) => {
      crc = crc32.table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    });
    return (crc ^ 0xffffffff) >>> 0;
  }

  function writeUint16(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
  }

  function writeUint32(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
    bytes[offset + 2] = (value >>> 16) & 0xff;
    bytes[offset + 3] = (value >>> 24) & 0xff;
  }

  function createZip(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    Object.entries(files).forEach(([name, content]) => {
      const nameBytes = encoder.encode(name);
      const dataBytes = encoder.encode(content);
      const checksum = crc32(dataBytes);
      const local = new Uint8Array(30 + nameBytes.length + dataBytes.length);
      writeUint32(local, 0, 0x04034b50);
      writeUint16(local, 4, 20);
      writeUint16(local, 6, 0x0800);
      writeUint16(local, 8, 0);
      writeUint16(local, 10, dosTime);
      writeUint16(local, 12, dosDate);
      writeUint32(local, 14, checksum);
      writeUint32(local, 18, dataBytes.length);
      writeUint32(local, 22, dataBytes.length);
      writeUint16(local, 26, nameBytes.length);
      writeUint16(local, 28, 0);
      local.set(nameBytes, 30);
      local.set(dataBytes, 30 + nameBytes.length);
      localParts.push(local);

      const central = new Uint8Array(46 + nameBytes.length);
      writeUint32(central, 0, 0x02014b50);
      writeUint16(central, 4, 20);
      writeUint16(central, 6, 20);
      writeUint16(central, 8, 0x0800);
      writeUint16(central, 10, 0);
      writeUint16(central, 12, dosTime);
      writeUint16(central, 14, dosDate);
      writeUint32(central, 16, checksum);
      writeUint32(central, 20, dataBytes.length);
      writeUint32(central, 24, dataBytes.length);
      writeUint16(central, 28, nameBytes.length);
      writeUint16(central, 30, 0);
      writeUint16(central, 32, 0);
      writeUint16(central, 34, 0);
      writeUint16(central, 36, 0);
      writeUint32(central, 38, 0);
      writeUint32(central, 42, localOffset);
      central.set(nameBytes, 46);
      centralParts.push(central);
      localOffset += local.length;
    });

    const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
    const end = new Uint8Array(22);
    writeUint32(end, 0, 0x06054b50);
    writeUint16(end, 4, 0);
    writeUint16(end, 6, 0);
    writeUint16(end, 8, centralParts.length);
    writeUint16(end, 10, centralParts.length);
    writeUint32(end, 12, centralSize);
    writeUint32(end, 16, localOffset);
    writeUint16(end, 20, 0);
    return new Blob([...localParts, ...centralParts, end], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  function createExcelWorkbook(records) {
    const timestamp = new Date().toISOString();
    const files = {
      "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
      "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
      "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Container Repair Materials Report</dc:title><dc:creator>Container Repair Materials</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified></cp:coreProperties>`,
      "docProps/app.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Container Repair Materials</Application></Properties>`,
      "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Repair Records" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">&apos;Repair Records&apos;!$1:$3</definedName></definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
      "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="0.####"/><numFmt numFmtId="165" formatCode="m/d/yyyy"/><numFmt numFmtId="166" formatCode="#,##0.00"/></numFmts><fonts count="5"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="16"/><name val="Calibri"/></font><font><i/><color rgb="FF64748B"/><sz val="10"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FF102B43"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF102B43"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17425F"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF28C28"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD8E0E7"/></left><right style="thin"><color rgb="FFD8E0E7"/></right><top style="thin"><color rgb="FFD8E0E7"/></top><bottom style="thin"><color rgb="FFD8E0E7"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="11"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="166" fontId="4" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
      "xl/worksheets/sheet1.xml": buildWorksheet(records),
    };
    return createZip(files);
  }

  function exportExcel() {
    const records = filteredRecords();
    if (!records.length) {
      showToast("No records to export for this date range.", "error");
      return;
    }
    const blob = createExcelWorkbook(records);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const range = state.filters.from || state.filters.to
      ? `-${state.filters.from || "start"}-to-${state.filters.to || "end"}`
      : "";
    link.href = url;
    link.download = `container-repair-records${range}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast(`${records.length} record${records.length === 1 ? "" : "s"} exported to Excel.`, "success");
  }

  function printRecords() {
    const records = filteredRecords();
    if (!records.length) {
      showToast("No records to print for this date range.", "error");
      return;
    }
    showTab("records");
    document.querySelectorAll("#records-list details.record-card").forEach((card) => {
      card.open = true;
    });
    if (typeof window.print === "function") window.setTimeout(() => window.print(), 80);
  }

  async function loadRecords() {
    state.recordsRequest = (state.recordsRequest || 0) + 1;
    const requestVersion = state.recordsRequest;
    state.recordsLoading = true;
    elements.recordsList.innerHTML = '<div class="state-card">Loading records…</div>';
    setSyncStatus("Firebase: syncing…", "loading");
    try {
      const payload = await firebaseRequest(recordsQueryUrl());
      if (requestVersion !== state.recordsRequest) return;
      state.repairs = recordsFromFirebase(payload);
      state.recordsLoaded = true;
      setSyncStatus("Firebase: connected", "success");
      renderRecords();
    } catch (error) {
      if (requestVersion !== state.recordsRequest) return;
      state.recordsLoaded = false;
      setSyncStatus("Firebase: unavailable", "error");
      elements.recordsList.innerHTML = `<div class="state-card error"><strong>Unable to read saved records.</strong><br>${escapeHtml(error.message || "Check your internet connection and Firebase rules.")}</div>`;
    } finally {
      if (requestVersion === state.recordsRequest) state.recordsLoading = false;
    }
  }

  function showTab(name) {
    document.querySelectorAll(".tab").forEach((button) => {
      const active = button.dataset.tab === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll(".view").forEach((view) => {
      const active = view.id === `${name}-view`;
      view.classList.toggle("active", active);
      view.hidden = !active;
    });
    if (name === "records" && !state.recordsLoaded) void loadRecords();
  }

  elements.damageOptions.innerHTML = damageOptions
    .map((damage) => `<option value="${escapeHtml(damage)}"></option>`)
    .join("");
  document.querySelector("#damage-count").textContent = String(source.damageCount);
  clearLegacyLocalRecords();
  elements.repairDate.value = defaultRepairDate();

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => showTab(button.dataset.tab));
  });
  elements.addDamage.addEventListener("click", () => {
    state.damages.push(newDamage());
    renderDamages();
  });
  elements.saveRecord.addEventListener("click", saveRecord);
  elements.cancelEdit.addEventListener("click", () => {
    resetForm();
    showToast("Edit cancelled.");
  });
  [elements.laborCost, elements.materialCost, elements.wWash].forEach((input) => {
    input.addEventListener("input", updateCostTotal);
  });
  elements.refreshRecords.addEventListener("click", () => {
    state.recordsLoaded = false;
    void loadRecords();
  });
  elements.exportExcel.addEventListener("click", exportExcel);
  elements.printRecords.addEventListener("click", printRecords);
  [elements.filterFrom, elements.filterTo].forEach((input) => {
    input.addEventListener("change", () => {
      state.filters.from = elements.filterFrom.value;
      state.filters.to = elements.filterTo.value;
      state.recordsLoaded = false;
      void loadRecords();
    });
  });
  elements.clearFilter.addEventListener("click", () => {
    elements.filterFrom.value = "";
    elements.filterTo.value = "";
    state.filters = { from: "", to: "" };
    state.recordsLoaded = false;
    void loadRecords();
  });
  elements.recordsList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action='edit-record']");
    if (button) editRecord(button.dataset.id);
  });
  elements.containerNumber.addEventListener("input", (event) => {
    event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });
  elements.damageList.addEventListener("change", (event) => {
    const target = event.target;
    const action = target.dataset.action;
    if (action === "damage") chooseDamage(target.dataset.id, target.value.trim());
    if (action === "quantity") changeQuantity(target.dataset.id, Number(target.value));
    if (action === "spec") {
      chooseSpec(target.dataset.damageId, target.dataset.materialId, target.value);
    }
  });
  elements.damageList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action='remove']");
    if (!button || state.damages.length === 1) return;
    state.damages = state.damages.filter((entry) => entry.id !== button.dataset.id);
    renderDamages();
  });

  updateCostTotal();
  renderDamages();
})();
