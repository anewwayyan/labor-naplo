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

    function formatBytes(bytes) {
      if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function handleFile(file) {
      if (!file) return;
      const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
      const extensionOK = /\.(pdf|jpe?g|png)$/i.test(file.name);
      if (!allowed.includes(file.type) && !extensionOK) {
        showToast('Ezt a fájltípust nem támogatjuk. PDF, JPG vagy PNG fájlt válassz.');
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        showToast('A fájl túl nagy. A maximális méret 20 MB.');
        return;
      }
      fileName.textContent = file.name;
      fileSize.textContent = formatBytes(file.size);
      selectedFile.classList.add('visible');
      showToast('A fájl kiválasztva. Ez a prototípus még nem tölti fel.');
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


    // Profile data is fetched from the authenticated API and is never persisted in browser storage.
    const profileForm = document.getElementById('profileForm');
    const profileStatus = document.getElementById('profileStatus');
    const saveProfileButton = document.getElementById('saveProfileButton');
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
