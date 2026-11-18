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
    }

    allNavButtons.forEach(button => button.addEventListener('click', () => navigate(button.dataset.page)));
    document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.go)));

    const fileInput = document.getElementById('fileInput');
    const dropzone = document.getElementById('dropzone');
    const selectedFile = document.getElementById('selectedFile');
    const fileName = document.getElementById('fileName');
    const fileSize = document.getElementById('fileSize');
    const uploadButton = document.getElementById('uploadFile');

    function formatBytes(bytes) {
      if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function handleFile(file) {
      if (!file) return;
      const isPdf = /\.pdf$/i.test(file.name) &&
        (!file.type || file.type === 'application/pdf' || file.type === 'application/octet-stream');
      if (!isPdf) {
        showToast('Csak PDF-fájlt lehet kiválasztani.');
        fileInput.value = '';
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        showToast('A fájl túl nagy. A maximális méret 20 MB.');
        return;
      }
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
      fileInput.value = '';
      uploadButton.disabled = true;
      selectedFile.classList.remove('visible');
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
      const file = fileInput.files[0];
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
        fileInput.value = '';
        selectedFile.classList.remove('visible');
        showToast(`Sikeres feltöltés: ${uploadedName}`);
      } catch (error) {
        console.error('[LaborNapló upload]', error);
        showToast(error?.message || 'A feltöltés nem sikerült. Próbáld újra.');
        uploadButton.disabled = false;
      } finally {
        uploadButton.textContent = 'Feltöltés';
      }
    });
