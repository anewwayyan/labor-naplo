const pages = ['home', 'results', 'documents', 'profile'];
const allNavButtons = document.querySelectorAll('[data-page]');
const toast = document.getElementById('toast');
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function navigate(page) {
  if (!pages.includes(page)) return;
  pages.forEach(name => document.getElementById(`page-${name}`).classList.toggle('active', name === page));
  allNavButtons.forEach(button => button.classList.toggle('active', button.dataset.page === page));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (page === 'documents') loadReports();
  if (page === 'results') loadLabValues();
}

allNavButtons.forEach(button => button.addEventListener('click', () => navigate(button.dataset.page)));
document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.go)));

const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const selectedFile = document.getElementById('selectedFile');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const uploadButton = document.getElementById('uploadFile');
let selectedPdfFile = null;

const reportsList = document.getElementById('reportsList');
const reportsLoading = document.getElementById('reportsLoading');
const reportsEmpty = document.getElementById('reportsEmpty');
const reportsError = document.getElementById('reportsError');
const reportsCount = document.getElementById('reportsCount');
let reportsLoaded = false;
let reportsLoadingNow = false;
let activePdfObjectUrl = null;
const pdfPreview = document.getElementById('pdfPreview');
const pdfPreviewFrame = document.getElementById('pdfPreviewFrame');
const pdfPreviewTitle = document.getElementById('pdfPreviewTitle');
const pdfPreviewError = document.getElementById('pdfPreviewError');
const pdfPreviewLoading = document.getElementById('pdfPreviewLoading');

function formatBytes(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return 'Nincs megadva';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Nincs megadva';
  return new Intl.DateTimeFormat('hu-HU').format(date);
}

function statusText(status) {
  const labels = {
    Draft: 'Feldolgozásra vár',
    Review: 'Ellenőrzés szükséges',
    Approved: 'Jóváhagyva',
    DeletePending: 'Törlésre vár'
  };
  return labels[status] || 'Ismeretlen állapot';
}

function appendReportDetail(container, label, value) {
  const item = document.createElement('div');
  item.className = 'report-detail';
  const caption = document.createElement('span');
  caption.textContent = label;
  const content = document.createElement('strong');
  content.textContent = value;
  item.append(caption, content);
  container.append(item);
}

async function deleteReport(reportId, button) {
  if (!window.confirm('Biztosan törlöd ezt a leletet? A PDF-fájl eltávolításra kerül, és a művelet nem vonható vissza.')) {
    return;
  }
  if (!window.LABORNAPLO_AUTH?.deleteReport) {
    showToast('A törlés szolgáltatás még nem érhető el. Frissítsd az oldalt később.');
    return;
  }

  button.disabled = true;
  button.textContent = 'Törlés…';
  try {
    await window.LABORNAPLO_AUTH.deleteReport(reportId);
    reportsLoaded = false;
    showToast('A lelet törlése sikerült.');
    await loadReports(true);
  } catch (error) {
    console.error('[Leletke report delete]', error);
    showToast(error?.message || 'A lelet törlése nem sikerült. Próbáld újra.');
    button.disabled = false;
    button.textContent = 'Törlés';
  }
}

function closePdfPreview() {
  pdfPreview.hidden = true;
  pdfPreviewFrame.removeAttribute('src');
  if (activePdfObjectUrl) {
    URL.revokeObjectURL(activePdfObjectUrl);
    activePdfObjectUrl = null;
  }
  pdfPreviewError.hidden = true;
  pdfPreviewLoading.hidden = true;
  document.body.classList.remove('pdf-preview-open');
}

async function openPdfPreview(report, button) {
  if (!window.LABORNAPLO_AUTH?.getReportPdf) {
    showToast('A PDF-megjelenítés még nem érhető el. Frissítsd az oldalt később.');
    return;
  }

  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = 'Megnyitás…';
  pdfPreview.hidden = false;
  pdfPreviewTitle.textContent = report.originalFileName || 'Laborlelet.pdf';
  pdfPreviewLoading.hidden = false;
  pdfPreviewError.hidden = true;
  document.body.classList.add('pdf-preview-open');

  try {
    const pdfBlob = await window.LABORNAPLO_AUTH.getReportPdf(report.reportId);
    if (pdfPreview.hidden) return;
    if (activePdfObjectUrl) URL.revokeObjectURL(activePdfObjectUrl);
    activePdfObjectUrl = URL.createObjectURL(pdfBlob);
    // Keep the browser's built-in PDF controls available for page navigation
    // and zoom. The temporary object URL is revoked when the viewer closes.
    pdfPreviewFrame.src = activePdfObjectUrl;
  } catch (error) {
    console.error('[Leletke PDF preview]', error);
    pdfPreviewError.textContent = error?.message || 'A PDF megnyitása nem sikerült.';
    pdfPreviewError.hidden = false;
  } finally {
    pdfPreviewLoading.hidden = true;
    button.disabled = false;
    button.textContent = originalText;
  }
}

function renderReports(reports) {
  reportsList.replaceChildren();
  reportsCount.textContent = `${reports.length} ${reports.length === 1 ? 'lelet' : 'lelet'}`;

  if (reports.length === 0) {
    reportsEmpty.hidden = false;
    return;
  }

  reportsEmpty.hidden = true;
  for (const report of reports) {
    const card = document.createElement('article');
    card.className = 'card report-card';

    const header = document.createElement('div');
    header.className = 'report-card-header';

    const file = document.createElement('div');
    file.className = 'report-file';
    const icon = document.createElement('div');
    icon.className = 'file-badge';
    icon.textContent = '▤';
    const nameWrap = document.createElement('div');
    nameWrap.className = 'report-file-name';
    const name = document.createElement('strong');
    name.textContent = report.originalFileName || 'Névtelen lelet.pdf';
    const uploaded = document.createElement('span');
    uploaded.textContent = `Feltöltve: ${formatDate(report.createdAt)}`;
    nameWrap.append(name, uploaded);
    file.append(icon, nameWrap);

    const actions = document.createElement('div');
    actions.className = 'report-card-actions';
    const status = document.createElement('span');
    status.className = `report-status ${report.status === 'Approved' ? 'is-approved' : report.status === 'Draft' ? 'is-draft' : report.status === 'Review' ? 'is-review' : ''}`;
    status.textContent = statusText(report.status);

    const deleteButton = document.createElement('button');
    const previewButton = document.createElement('button');
    previewButton.type = 'button';
    previewButton.className = 'report-preview-btn';
    previewButton.textContent = 'PDF megtekintése';
    previewButton.setAttribute('aria-label', `PDF megtekintése: ${report.originalFileName || 'Névtelen lelet'}`);
    previewButton.addEventListener('click', () => openPdfPreview(report, previewButton));

    deleteButton.type = 'button';
    deleteButton.className = 'report-delete-btn';
    deleteButton.textContent = 'Törlés';
    deleteButton.setAttribute('aria-label', `Lelet törlése: ${report.originalFileName || 'Névtelen lelet'}`);
    deleteButton.addEventListener('click', () => deleteReport(report.reportId, deleteButton));
    if (report.status === 'Draft' || report.status === 'Review') {
      const processButton = document.createElement('button');
      processButton.type = 'button';
      processButton.className = 'report-preview-btn';
      processButton.textContent = report.status === 'Review' ? 'Ellenőrzés' : 'Feldolgozás';
      processButton.addEventListener('click', () => {
        if (report.status === 'Review') openReportReview(report);
        else startReportExtraction(report, processButton);
      });
      actions.append(status, processButton, previewButton, deleteButton);
    } else {
      actions.append(status, previewButton, deleteButton);
    }
    header.append(file, actions);

    const details = document.createElement('div');
    details.className = 'report-details';
    appendReportDetail(details, 'Laboratórium', report.labName || 'Nincs megadva');
    appendReportDetail(details, 'Mintavétel dátuma', formatDate(report.sampleDate));
    appendReportDetail(details, 'Fájlméret', formatBytes(report.fileSizeBytes));

    card.append(header, details);
    reportsList.append(card);
  }
}

async function loadReports(force = false) {
  if (reportsLoadingNow || (reportsLoaded && !force)) return;
  if (!window.LABORNAPLO_AUTH?.listReports) {
    reportsError.hidden = false;
    reportsError.textContent = 'A leletlista szolgáltatás még nem érhető el. Frissítsd az oldalt később.';
    return;
  }

  reportsLoadingNow = true;
  reportsLoading.hidden = false;
  reportsEmpty.hidden = true;
  reportsError.hidden = true;
  try {
    const reports = await window.LABORNAPLO_AUTH.listReports();
    renderReports(reports);
    reportsLoaded = true;
  } catch (error) {
    console.error('[Leletke reports]', error);
    reportsError.textContent = error?.message || 'A leletek betöltése nem sikerült.';
    reportsError.hidden = false;
  } finally {
    reportsLoading.hidden = true;
    reportsLoadingNow = false;
  }
}

document.getElementById('refreshReports').addEventListener('click', () => loadReports(true));

function clearSelectedFile() {
  selectedPdfFile = null;
  fileInput.value = '';
  uploadButton.disabled = true;
  selectedFile.classList.remove('visible');
}

function handleFile(file) {
  if (!file) return;
  const isPdf = /\.pdf$/i.test(file.name) &&
    (!file.type || file.type === 'application/pdf' || file.type === 'application/octet-stream');
  if (!isPdf) {
    clearSelectedFile();
    showToast('Csak PDF-fájlt lehet kiválasztani.');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    clearSelectedFile();
    showToast('A fájl túl nagy. A maximális méret 20 MB.');
    return;
  }
  selectedPdfFile = file;
  fileName.textContent = file.name;
  fileSize.textContent = formatBytes(file.size);
  selectedFile.classList.add('visible');
  uploadButton.disabled = false;
  showToast('A PDF kiválasztva. Feltöltésre kész.');
}

document.getElementById('topUpload').addEventListener('click', () => {
  navigate('home');
  document.getElementById('upload-area').scrollIntoView({ behavior: 'smooth', block: 'center' });
  fileInput.click();
});
dropzone.addEventListener('click', event => {
  if (event.target.closest('button')) return;
  fileInput.click();
});
dropzone.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));
document.getElementById('removeFile').addEventListener('click', () => {
  clearSelectedFile();
  showToast('A kiválasztott fájl eltávolítva.');
});

['dragenter', 'dragover'].forEach(type => dropzone.addEventListener(type, event => {
  event.preventDefault(); dropzone.classList.add('dragover');
}));
['dragleave', 'drop'].forEach(type => dropzone.addEventListener(type, event => {
  event.preventDefault(); dropzone.classList.remove('dragover');
}));
dropzone.addEventListener('drop', event => handleFile(event.dataTransfer.files[0]));

uploadButton.addEventListener('click', async () => {
  const file = selectedPdfFile;
  if (!file) {
    showToast('Előbb válassz ki egy PDF-fájlt.');
    return;
  }
  if (!window.LABORNAPLO_AUTH?.uploadPdf) {
    showToast('A biztonságos feltöltés még nem érhető el. Frissítsd az oldalt.');
    return;
  }

  uploadButton.disabled = true;
  uploadButton.classList.add('is-loading');
  uploadButton.setAttribute('aria-busy', 'true');
  uploadButton.textContent = 'Feltöltés…';
  try {
    const result = await window.LABORNAPLO_AUTH.uploadPdf(file);
    const uploadedName = result.report.originalFileName || file.name;
    clearSelectedFile();
    showToast(`Sikeres feltöltés: ${uploadedName}`);
    reportsLoaded = false;
    if (document.getElementById('page-documents').classList.contains('active')) {
      await loadReports(true);
    }
  } catch (error) {
    console.error('[Leletke upload]', error);
    showToast(error?.message || 'A feltöltés nem sikerült. Próbáld újra.');
    uploadButton.disabled = !selectedPdfFile;
  } finally {
    uploadButton.classList.remove('is-loading');
    uploadButton.removeAttribute('aria-busy');
    uploadButton.textContent = 'Feltöltés';
  }
});


// Laboratory OCR review and approved result rendering.
const reviewPanel = document.getElementById('reviewPanel');
const reviewValuesContainer = document.getElementById('reviewValues');
const reviewReportName = document.getElementById('reviewReportName');
const reviewStatus = document.getElementById('reviewStatus');
const approveValuesButton = document.getElementById('approveValuesButton');
const labValuesList = document.getElementById('labValuesList');
const labValuesEmpty = document.getElementById('labValuesEmpty');
const labValuesError = document.getElementById('labValuesError');
const labValuesCount = document.getElementById('labValuesCount');
let activeReviewReport = null;
let reviewItems = [];
let labValuesLoading = false;

function setReviewStatus(message, state = '') {
  reviewStatus.textContent = message;
  reviewStatus.dataset.state = state;
}

function createReviewField(label, value, field) {
  const wrapper = document.createElement('label');
  wrapper.className = 'review-field';
  const caption = document.createElement('span');
  caption.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value ?? '';
  input.dataset.field = field;
  input.autocomplete = 'off';
  wrapper.append(caption, input);
  return wrapper;
}

function renderReviewItems() {
  reviewValuesContainer.replaceChildren();
  reviewItems.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'review-value-row';
    row.dataset.index = String(index);
    row.append(
      createReviewField('Vizsgálat neve', item.rawParameterName || '', 'parameterName'),
      createReviewField('Eredmény', item.parsedNumericValue ?? item.rawValue ?? '', 'value'),
      createReviewField('Mértékegység', item.unit || '', 'unit'),
      createReviewField('Referencia-tartomány', item.referenceRange || '', 'referenceRange')
    );
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'review-remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', 'Érték eltávolítása');
    remove.addEventListener('click', () => {
      reviewItems.splice(index, 1);
      renderReviewItems();
      setReviewStatus('A törölt sor nem kerül mentésre.');
    });
    row.append(remove);
    reviewValuesContainer.append(row);
  });
  approveValuesButton.disabled = reviewItems.length === 0;
}

function showReportReview(report, items) {
  activeReviewReport = report;
  reviewItems = Array.isArray(items) ? items.map(item => ({ ...item })) : [];
  reviewReportName.textContent = report.originalFileName || 'Feltöltött laborlelet';
  reviewPanel.hidden = false;
  setReviewStatus(reviewItems.length + ' felismert érték. Mentés előtt ellenőrizd őket.');
  renderReviewItems();
  navigate('results');
  reviewPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function openReportReview(report) {
  if (!window.LABORNAPLO_AUTH?.listExtractedReportValues) {
    showToast('Az ellenőrző felület még nem érhető el. Frissítsd az oldalt.');
    return;
  }
  try {
    const items = await window.LABORNAPLO_AUTH.listExtractedReportValues(report.reportId);
    showReportReview(report, items);
  } catch (error) {
    showToast(error?.message || 'A kinyert értékek betöltése nem sikerült.');
  }
}

async function startReportExtraction(report, button) {
  if (!window.LABORNAPLO_AUTH?.extractReportValues) {
    showToast('A leletfeldolgozás még nincs összekötve az API-val.');
    return;
  }
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = 'Feldolgozás…';
  try {
    const result = await window.LABORNAPLO_AUTH.extractReportValues(report.reportId);
    showToast(result.alreadyProcessed ? 'A lelet már fel van dolgozva.' : 'A lelet feldolgozása elkészült.');
    showReportReview(report, result.items || []);
    reportsLoaded = false;
  } catch (error) {
    console.error('[Leletke OCR]', error);
    showToast(error?.message || 'A lelet feldolgozása nem sikerült.');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function parseReferenceRange(value) {
  const match = String(value || '').match(/(-?\d+(?:[.,]\d+)?)\s*(?:-|–|—|\bto\b)\s*(-?\d+(?:[.,]\d+)?)/i);
  if (!match) return { low: null, high: null };
  const low = Number(match[1].replace(',', '.'));
  const high = Number(match[2].replace(',', '.'));
  return Number.isFinite(low) && Number.isFinite(high) && low <= high
    ? { low, high } : { low: null, high: null };
}

approveValuesButton.addEventListener('click', async () => {
  if (!activeReviewReport || !window.LABORNAPLO_AUTH?.approveReportValues) return;
  const rows = [...reviewValuesContainer.querySelectorAll('.review-value-row')];
  const values = [];
  try {
    for (const row of rows) {
      const read = field => row.querySelector('[data-field="' + field + '"]')?.value.trim() || '';
      const parameterName = read('parameterName');
      const rawValue = read('value');
      const unit = read('unit');
      const referenceRange = read('referenceRange');
      if (!parameterName || !rawValue) throw new Error('A vizsgálat neve és eredménye nem maradhat üresen.');
      const numericText = rawValue.replace(',', '.');
      const numeric = /^-?\d+(?:\.\d+)?$/.test(numericText) ? Number(numericText) : null;
      const range = parseReferenceRange(referenceRange);
      const isAbnormal = numeric !== null && range.low !== null && range.high !== null
        ? numeric < range.low || numeric > range.high : null;
      values.push({
        extractedValueId: reviewItems[Number(row.dataset.index)]?.extractedValueId,
        parameterName,
        valueNumeric: numeric,
        valueText: numeric === null ? rawValue : null,
        unit,
        referenceRange,
        referenceLow: range.low,
        referenceHigh: range.high,
        isAbnormal
      });
    }
    if (!values.length) throw new Error('Legalább egy laborértéket hagyj meg a mentéshez.');
    approveValuesButton.disabled = true;
    setReviewStatus('Mentés folyamatban…');
    await window.LABORNAPLO_AUTH.approveReportValues(activeReviewReport.reportId, values);
    setReviewStatus('A jóváhagyott laborértékek mentése sikerült.', 'success');
    reviewPanel.hidden = true;
    activeReviewReport = null;
    reviewItems = [];
    showToast('A laborértékek mentése sikerült.');
    await loadLabValues(true);
    reportsLoaded = false;
  } catch (error) {
    setReviewStatus(error?.message || 'A mentés nem sikerült. Ellenőrizd az adatokat.', 'error');
    approveValuesButton.disabled = false;
  }
});

async function loadLabValues(force = false) {
  if (labValuesLoading) return;
  if (!window.LABORNAPLO_AUTH?.listLabValues) {
    labValuesError.hidden = false;
    labValuesError.textContent = 'A laboreredmények szolgáltatás még nem érhető el.';
    return;
  }
  labValuesLoading = true;
  labValuesError.hidden = true;
  try {
    const items = await window.LABORNAPLO_AUTH.listLabValues();
    labValuesList.replaceChildren();
    labValuesCount.textContent = items.length + ' érték';
    labValuesEmpty.hidden = items.length > 0;
    for (const item of items) {
      const card = document.createElement('article');
      card.className = 'card lab-value-card';
      const main = document.createElement('div');
      main.className = 'lab-value-main';
      const name = document.createElement('div');
      name.className = 'lab-value-name';
      name.textContent = item.parameterName || 'Laborvizsgálat';
      const result = document.createElement('strong');
      result.className = 'lab-value-result';
      result.textContent = String(item.valueNumeric ?? item.valueText ?? '—') + (item.unit ? ' ' + item.unit : '');
      main.append(name, result);
      const meta = document.createElement('div');
      meta.className = 'lab-value-meta';
      const date = document.createElement('span');
      date.textContent = 'Mintavétel: ' + formatDate(item.sampleDate);
      const lab = document.createElement('span');
      lab.textContent = item.labName || item.originalFileName || 'Laborlelet';
      meta.append(date, lab);
      if (item.referenceRange) {
        const reference = document.createElement('span');
        reference.textContent = 'Referencia: ' + item.referenceRange;
        meta.append(reference);
      }
      const flag = document.createElement('span');
      flag.className = 'lab-value-flag ' + (item.isAbnormal === false ? 'is-normal' : '');
      flag.textContent = item.isAbnormal === true ? 'Referencia-tartományon kívül' :
        item.isAbnormal === false ? 'Referencia-tartományon belül' : 'Nincs besorolva';
      meta.append(flag);
      card.append(main, meta);
      labValuesList.append(card);
    }
  } catch (error) {
    labValuesError.textContent = error?.message || 'A laboreredmények betöltése nem sikerült.';
    labValuesError.hidden = false;
  } finally {
    labValuesLoading = false;
  }
}

document.getElementById('refreshLabValues').addEventListener('click', () => loadLabValues(true));


document.getElementById('pdfPreviewClose').addEventListener('click', closePdfPreview);
document.getElementById('pdfPreviewBackdrop').addEventListener('click', closePdfPreview);
document.getElementById('pdfPreviewFullscreen').addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) await pdfPreview.querySelector('.pdf-preview-panel').requestFullscreen();
    else await document.exitFullscreen();
  } catch (error) {
    showToast('A teljes képernyős mód nem érhető el ebben a böngészőben.');
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !pdfPreview.hidden && !document.fullscreenElement) closePdfPreview();
});


// Profile data is fetched from the authenticated API and is never persisted in browser storage.
    const profileForm = document.getElementById('profileForm');
    const profileStatus = document.getElementById('profileStatus');
    const saveProfileButton = document.getElementById('saveProfileButton');
    const profileDateOfBirth = document.getElementById('profileDateOfBirth');

    // Birth dates must be between 1900-01-01 and today's local date.
    // Compute max at runtime so the allowed latest date advances automatically.
    function updateBirthDateLimits() {
      const now = new Date();
      const today = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0')
      ].join('-');
      profileDateOfBirth.min = '1900-01-01';
      profileDateOfBirth.max = today;
    }

    updateBirthDateLimits();
    const homeGreeting = document.getElementById('homeGreeting');
    let profileLoaded = false;
    let profileLoading = false;
    let profileSaving = false;

    function setProfileStatus(message, state = '') {
      profileStatus.textContent = message;
      profileStatus.dataset.state = state;
    }

    function renderGreeting(profile) {
      const enabled = profile?.greetingEnabled !== false;
      const name = (profile?.preferredName || profile?.firstName || '').trim();
      homeGreeting.textContent = name ? `Szia, ${name}!` : 'Szia!';
      homeGreeting.hidden = !enabled;
    }

    function fillProfile(profile) {
      document.getElementById('profileFirstName').value = profile.firstName || '';
      document.getElementById('profilePreferredName').value = profile.preferredName || '';
      document.getElementById('profileDateOfBirth').value = profile.dateOfBirth || '';
      document.getElementById('profileSex').value = profile.sex || '';
      document.getElementById('profileGreetingEnabled').checked = profile.greetingEnabled !== false;
      renderGreeting(profile);
    }

    async function loadProfile(force = false) {
      if (profileLoading || (profileLoaded && !force)) return;
      if (typeof window.laborNaploApiRequest !== 'function') {
        setProfileStatus('A biztonságos kapcsolat még nem áll készen. Próbáld újra később.', 'error');
        return;
      }
      profileLoading = true;
      saveProfileButton.disabled = true;
      setProfileStatus('Profil betöltése…');
      try {
        const response = await window.laborNaploApiRequest('/api/profile', { method: 'GET' });
        const data = await response.json();
        if (!response.ok || !data.profile) throw new Error(data.message || 'A profil betöltése nem sikerült.');
        fillProfile(data.profile);
        profileLoaded = true;
        setProfileStatus(data.profileExists ? 'A profilod betöltve.' : 'Még nem adtál meg profiladatokat.');
        saveProfileButton.disabled = false;
      } catch (error) {
        setProfileStatus(error.message || 'A profil jelenleg nem érhető el.', 'error');
        saveProfileButton.disabled = true;
      } finally {
        profileLoading = false;
      }
    }

    profileForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (profileSaving || !profileLoaded || typeof window.laborNaploApiRequest !== 'function') return;
      updateBirthDateLimits();
      if (!profileDateOfBirth.checkValidity()) {
        profileDateOfBirth.reportValidity();
        setProfileStatus('A születési dátum 1900. január 1. és a mai nap közé essen.', 'error');
        return;
      }
      const payload = {
        firstName: document.getElementById('profileFirstName').value,
        preferredName: document.getElementById('profilePreferredName').value,
        dateOfBirth: document.getElementById('profileDateOfBirth').value || null,
        sex: document.getElementById('profileSex').value || null,
        greetingEnabled: document.getElementById('profileGreetingEnabled').checked
      };
      profileSaving = true;
      saveProfileButton.disabled = true;
      saveProfileButton.textContent = 'Mentés…';
      setProfileStatus('Mentés folyamatban…');
      try {
        const response = await window.laborNaploApiRequest('/api/profile', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok || data.saved !== true || !data.profile) throw new Error(data.message || 'A mentés nem sikerült.');
        fillProfile(data.profile);
        setProfileStatus('A profilod sikeresen mentve.', 'success');
        showToast('A profil mentése sikerült.');
      } catch (error) {
        setProfileStatus(error.message || 'A mentés nem sikerült. Próbáld újra.', 'error');
      } finally {
        profileSaving = false;
        saveProfileButton.disabled = false;
        saveProfileButton.textContent = 'Mentés';
      }
    });

    window.addEventListener('labor-naplo-authenticated', () => {
      loadProfile(true);
    });
