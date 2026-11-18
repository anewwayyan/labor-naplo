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
    Draft: 'Piszkozat',
    Review: 'Ellenőrzés alatt',
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
    console.error('[LaborNapló report delete]', error);
    showToast(error?.message || 'A lelet törlése nem sikerült. Próbáld újra.');
    button.disabled = false;
    button.textContent = 'Törlés';
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
    status.className = `report-status ${report.status === 'Approved' ? 'is-approved' : report.status === 'Draft' ? 'is-draft' : ''}`;
    status.textContent = statusText(report.status);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'report-delete-btn';
    deleteButton.textContent = 'Törlés';
    deleteButton.setAttribute('aria-label', `Lelet törlése: ${report.originalFileName || 'Névtelen lelet'}`);
    deleteButton.addEventListener('click', () => deleteReport(report.reportId, deleteButton));
    actions.append(status, deleteButton);
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
    console.error('[LaborNapló reports]', error);
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
    console.error('[LaborNapló upload]', error);
    showToast(error?.message || 'A feltöltés nem sikerült. Próbáld újra.');
    uploadButton.disabled = !selectedPdfFile;
  } finally {
    uploadButton.textContent = 'Feltöltés';
  }
});
